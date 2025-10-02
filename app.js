
let wasmModule = null;
let gradientGenerator = null;
let canvas = null;
let ctx = null;
let backgroundCanvas = null;
let backgroundCtx = null;

let isGenerating = false;
let pendingGeneration = false;
let generationTimeout = null;
let lastParams = null;

let history = [];
let historyIndex = -1;
const MAX_HISTORY = 100;
let isApplyingHistory = false;

let currentWidth = 2000;
let currentHeight = 2000;

// Performance optimization: Use lower resolution for real-time preview
let previewWidth = 800;
let previewHeight = 800;

function updatePreviewResolution() {
    const aspectRatio = currentWidth / currentHeight;
    const maxPreviewSize = 800;
    
    if (aspectRatio >= 1) {
        previewWidth = maxPreviewSize;
        previewHeight = Math.round(maxPreviewSize / aspectRatio);
    } else {
        previewHeight = maxPreviewSize;
        previewWidth = Math.round(maxPreviewSize * aspectRatio);
    }
}

let canvasOffset = { x: 0, y: 0 };
let canvasZoom = 1.0;
let canvasRotation = 0;
let isDragging = false;
let lastMousePos = { x: 0, y: 0 };

let colorCache = null;
let colorCacheVersion = 0;
let rgbColorCache = null;

let currentPreset = '';
let presetColors = [];

const domCache = {
    elements: new Map(),
    colorItems: null,
    sliders: new Map(),
    get(id) {
        if (!this.elements.has(id)) {
            this.elements.set(id, document.getElementById(id));
        }
        return this.elements.get(id);
    },
    getAll(selector) {
        return document.querySelectorAll(selector);
    },
    getColorItems() {
        if (!this.colorItems) {
            this.colorItems = document.querySelectorAll('.color-item');
        }
        return this.colorItems;
    },
    getColorPicker(index) {
        const key = `color-picker-${index}`;
        if (!this.elements.has(key)) {
            this.elements.set(key, document.getElementById(`color-${index}`));
        }
        return this.elements.get(key);
    },
    clear() {
        this.elements.clear();
        this.colorItems = null;
        this.sliders.clear();
    }
};

const hexToRgbCache = new Map();
let resizeBackgroundTimeout = null;

async function init() {
    try {
        
        wasmModule = await import('./pkg/gradient_noise_wasm.js');
        await wasmModule.default();
        
        gradientGenerator = new wasmModule.GradientGenerator();
        
        canvas = document.getElementById('canvas');
        ctx = canvas.getContext('2d', { alpha: true });
        backgroundCanvas = document.getElementById('background-canvas');
        backgroundCtx = backgroundCanvas.getContext('2d', { alpha: true });
        
        if (!canvas || !ctx || !backgroundCanvas || !backgroundCtx) {
            throw new Error('Canvas not found or context creation failed');
        }
        
        document.getElementById('loading').style.display = 'none';
        document.getElementById('app').style.display = 'flex';
        
        setupEventListeners();
        handleAspectRatioChange();
        
        updatePreviewResolution();
        
        window.addEventListener('resize', () => {
            if (resizeBackgroundTimeout) clearTimeout(resizeBackgroundTimeout);
            resizeBackgroundTimeout = setTimeout(() => {
                updateBackgroundCanvas();
            }, 100);
        });
        
    } catch (error) {
        console.error('Initialization failed:', error);
        showError('Failed to initialize: ' + error.message);
    }
}

function setupResponsiveCanvas() {
    if (!canvas) return;
    
    function resizeCanvas() {
        const container = canvas.parentElement;
        const containerRect = container.getBoundingClientRect();
        
        const containerStyle = window.getComputedStyle(container);
        const paddingLeft = parseFloat(containerStyle.paddingLeft);
        const paddingRight = parseFloat(containerStyle.paddingRight);
        const paddingTop = parseFloat(containerStyle.paddingTop);
        const paddingBottom = parseFloat(containerStyle.paddingBottom);
        
        const availableWidth = containerRect.width - paddingLeft - paddingRight;
        const availableHeight = containerRect.height - paddingTop - paddingBottom;
        
        const canvasAspectRatio = canvas.width / canvas.height;
        const containerAspectRatio = availableWidth / availableHeight;
        
        let displayWidth, displayHeight;
        
        if (canvasAspectRatio > containerAspectRatio) {
            displayWidth = availableWidth;
            displayHeight = availableWidth / canvasAspectRatio;
        } else {
            displayHeight = availableHeight;
            displayWidth = availableHeight * canvasAspectRatio;
        }
        
        const minSize = 200;
        if (displayWidth < minSize || displayHeight < minSize) {
            const scale = minSize / Math.min(displayWidth, displayHeight);
            displayWidth *= scale;
            displayHeight *= scale;
        }
        
        canvas.style.width = `${Math.round(displayWidth)}px`;
        canvas.style.height = `${Math.round(displayHeight)}px`;
        
    }
    
    resizeCanvas();
    
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(resizeCanvas, 100);
    });
    if (window.ResizeObserver) {
        const resizeObserver = new ResizeObserver(() => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(resizeCanvas, 50);
        });
        resizeObserver.observe(canvas.parentElement);
    }
}

function setupEventListeners() {
    const sliders = [
        'seed', 'color-spread', 'flow-intensity', 'organic-distortion', 
        'color-variance', 'center-bias', 'canvas-rotation',
        'levels-shadows', 'levels-midtones', 'levels-highlights',
        'hue-shift', 'saturation', 'noise-amount', 'noise-scale'
    ];
    
    sliders.forEach(id => {
        const slider = document.getElementById(id);
        const valueDisplay = document.getElementById(`${id}-value`);
        
        if (slider && valueDisplay) {
            slider.addEventListener('input', (e) => {
                if (id === 'canvas-rotation') {
                    valueDisplay.textContent = e.target.value;
                    canvasRotation = parseFloat(e.target.value);
                    applyCanvasRotation();
                } else {
                    valueDisplay.textContent = e.target.value;
                    if (id === 'width' || id === 'height') {
                        return;
                    }
                    debouncedGenerateGradient();
                }
            });
        }
    });
    
    const blendModeSelect = document.getElementById('blend-mode');
    if (blendModeSelect) {
        blendModeSelect.addEventListener('change', () => {
            debouncedGenerateGradient();
        });
    }
    
    const aspectRatioSelect = document.getElementById('aspect-ratio');
    if (aspectRatioSelect) {
        aspectRatioSelect.addEventListener('change', handleAspectRatioChange);
    }
    
    document.getElementById('export')?.addEventListener('click', exportImage);
    
    const colorPresetSelect = document.getElementById('color-preset');
    if (colorPresetSelect) {
        colorPresetSelect.addEventListener('change', (e) => {
            if (e.target.value) {
                applyColorPreset(e.target.value);
                currentPreset = e.target.value;
                updatePresetColors();
            }
        });
    }
    
    for (let i = 0; i < 6; i++) {
        const colorPicker = domCache.getColorPicker(i);
        const alphaToggle = domCache.get(`alpha-toggle-${i}`);
        
        if (colorPicker) {
            colorPicker.addEventListener('input', () => {
                invalidateColorCache();
                checkForCustomChanges();
                debouncedGenerateGradient();
            });
        }
        
        if (alphaToggle) {
            alphaToggle.addEventListener('click', ((index) => {
                return (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleAlpha(index);
                };
            })(i));
        }
    }
    
    document.getElementById('undo')?.addEventListener('click', undo);
    document.getElementById('redo')?.addEventListener('click', redo);
    document.getElementById('reset-composition')?.addEventListener('click', resetComposition);
    document.getElementById('github-btn')?.addEventListener('click', () => {
        window.open('https://github.com/LandoNikko/Gradient-Generator', '_blank');
    });
    document.getElementById('randomize-blending')?.addEventListener('click', () => {
        randomizeBlending();
    });
    
    updateHistoryButtons();
    setupCanvasInteraction();
    initializeColors();
    setupColorDragAndDrop();
    setupAddColorButton();
    setupDropdownNavigation();
    setupDimensionInputs();
}

function setupDimensionInputs() {
    const widthInput = document.getElementById('width');
    const heightInput = document.getElementById('height');
    
    if (widthInput) {
        widthInput.addEventListener('input', () => {
            const width = parseInt(widthInput.value);
            const height = parseInt(document.getElementById('height').value);
            if (width && height) {
                applyDimensionsInternal(width, height);
            }
        });
    }
    
    if (heightInput) {
        heightInput.addEventListener('input', () => {
            const width = parseInt(document.getElementById('width').value);
            const height = parseInt(heightInput.value);
            if (width && height) {
                applyDimensionsInternal(width, height);
            }
        });
    }
}

function updateColorControlsVisibility(colorCount) {
    const colorItems = document.querySelectorAll('.color-item');
    colorItems.forEach((item, index) => {
        if (index < colorCount) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    });
    domCache.colorItems = null;
}

function getActiveColors() {
    const colorCount = getCurrentColorCount();
    
    if (colorCache && colorCache.count === colorCount && colorCache.version === colorCacheVersion) {
        return colorCache.colors;
    }
    
    const colors = [];
    for (let i = 0; i < colorCount; i++) {
        const colorPicker = domCache.getColorPicker(i);
        const alphaToggle = domCache.get(`alpha-toggle-${i}`);
        if (colorPicker && alphaToggle) {
            const alphaValue = parseInt(alphaToggle.dataset.alpha) / 100.0;
            colors.push({
                hex: colorPicker.value,
                alpha: alphaValue
            });
        }
    }
    
    colorCache = {
        colors: colors,
        count: colorCount,
        version: colorCacheVersion
    };
    
    return colors;
}

function toggleAlpha(colorIndex) {
    const alphaToggle = domCache.get(`alpha-toggle-${colorIndex}`);
    const colorPicker = domCache.getColorPicker(colorIndex);
    if (!alphaToggle || !colorPicker) return;
    
    const currentAlpha = parseInt(alphaToggle.dataset.alpha);
    const newAlpha = currentAlpha === 100 ? 0 : 100;
    
    alphaToggle.dataset.alpha = newAlpha;
    
    const icon = alphaToggle.querySelector('i');
    if (icon) {
        if (newAlpha === 0) {
            icon.className = 'ri-eye-off-line';
            colorPicker.classList.add('transparent');
        } else {
            icon.className = 'ri-eye-line';
            colorPicker.classList.remove('transparent');
        }
    }
    
    invalidateColorCache();
    checkForCustomChanges();
    debouncedGenerateGradient();
}

function invalidateColorCache() {
    colorCacheVersion++;
    rgbColorCache = null;
}

function getRgbColors() {
    if (rgbColorCache && rgbColorCache.version === colorCacheVersion) {
        return rgbColorCache.colors;
    }
    
    const activeColors = getActiveColors();
    const rgbColors = {};
    
    activeColors.forEach((colorData, index) => {
        const rgb = hexToRgb(colorData.hex);
        rgbColors[`color_${index + 1}`] = [rgb.r / 255.0, rgb.g / 255.0, rgb.b / 255.0, colorData.alpha];
    });
    
    for (let i = activeColors.length; i < 8; i++) {
        rgbColors[`color_${i + 1}`] = [0.0, 0.0, 0.0, 0.0];
    }
    
    rgbColorCache = {
        colors: rgbColors,
        version: colorCacheVersion
    };
    
    return rgbColors;
}

function updatePresetColors() {
    const activeColors = getActiveColors();
    presetColors = [...activeColors];
}

function checkForCustomChanges() {
    if (!currentPreset) {
        // If no preset is selected, set to custom when user makes changes
        setToCustomPreset();
        return;
    }
    
    const activeColors = getActiveColors();
    const hasChanged = activeColors.length !== presetColors.length || 
                      activeColors.some((color, index) => color !== presetColors[index]);
    
    if (hasChanged) {
        setToCustomPreset();
    }
}

function resetToNoPreset() {
    currentPreset = '';
    presetColors = [];
    const presetSelect = document.getElementById('color-preset');
    if (presetSelect) {
        const customOption = presetSelect.querySelector('option[value="custom"]');
        if (customOption) {
            customOption.remove();
        }
        presetSelect.value = '';
    }
}

function setToCustomPreset() {
    currentPreset = 'custom';
    const presetSelect = document.getElementById('color-preset');
    if (presetSelect) {
        let customOption = presetSelect.querySelector('option[value="custom"]');
        if (!customOption) {
            customOption = document.createElement('option');
            customOption.value = 'custom';
            customOption.textContent = 'Custom';
            presetSelect.appendChild(customOption);
        }
        presetSelect.value = 'custom';
    }
}

function initializeColors() {
    updateColorControlsVisibility(4);
    
    // Pick a random preset
    const presetNames = Object.keys(COLOR_PRESETS);
    const randomPresetName = presetNames[Math.floor(Math.random() * presetNames.length)];
    const randomPresetColors = COLOR_PRESETS[randomPresetName];
    
    const initialColors = randomPresetColors.slice(0, 4);
    updateColorPickers(initialColors);
    
    // Reset dropdown to show "Choose preset..." instead of any specific preset
    resetToNoPreset();
    
    updateAddButtonState();
}

function getCurrentColorCount() {
    const colorItems = domCache.getColorItems();
    let count = 0;
    colorItems.forEach(item => {
        if (item.style.display !== 'none') {
            count++;
        }
    });
    return count;
}

function updateAddButtonState() {
    const addBtn = document.getElementById('add-color-btn');
    const currentCount = getCurrentColorCount();
    if (addBtn) {
        addBtn.disabled = currentCount >= 6;
        if (currentCount >= 6) {
            addBtn.style.display = 'none';
        } else {
            addBtn.style.display = 'flex';
        }
    }
}

function setupAddColorButton() {
    const addBtn = document.getElementById('add-color-btn');
    if (addBtn) {
        addBtn.addEventListener('click', addColor);
    }
    
    const randomizeBtn = document.getElementById('randomize-colors');
    if (randomizeBtn) {
        randomizeBtn.addEventListener('click', () => {
            const randomSeed = Math.floor(Math.random() * 1000000);
            randomizeColors(randomSeed);
        });
    }
}

function setupDropdownNavigation() {
    const navButtons = document.querySelectorAll('.dropdown-nav-btn');
    
    navButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            e.preventDefault();
            const direction = button.dataset.direction;
            const targetId = button.dataset.target;
            const dropdown = document.getElementById(targetId);
            
            if (dropdown) {
                navigateDropdown(dropdown, direction);
            }
        });
    });
}

function navigateDropdown(dropdown, direction) {
    const options = Array.from(dropdown.options);
    const currentIndex = dropdown.selectedIndex;
    let newIndex = currentIndex;
    
    // Find next/prev non-disabled option
    if (direction === 'prev') {
        for (let i = 1; i <= options.length; i++) {
            const testIndex = (currentIndex - i + options.length) % options.length;
            if (!options[testIndex].disabled) {
                newIndex = testIndex;
                break;
            }
        }
    } else if (direction === 'next') {
        for (let i = 1; i <= options.length; i++) {
            const testIndex = (currentIndex + i) % options.length;
            if (!options[testIndex].disabled) {
                newIndex = testIndex;
                break;
            }
        }
    }
    
    if (newIndex !== currentIndex) {
        dropdown.selectedIndex = newIndex;
        
        const changeEvent = new Event('change', { bubbles: true });
        dropdown.dispatchEvent(changeEvent);
    }
}

function addColor() {
    const currentCount = getCurrentColorCount();
    if (currentCount >= 6) return;
    
    const lastColorPicker = domCache.getColorPicker(currentCount - 1);
    let newColor = '#ff6b6b';
    
    if (lastColorPicker) {
        newColor = generateDarkerColor(lastColorPicker.value);
    }
    
    const nextColorPicker = domCache.getColorPicker(currentCount);
    const nextAlphaToggle = domCache.get(`alpha-toggle-${currentCount}`);
    const nextColorItem = nextColorPicker?.closest('.color-item');
    
    if (nextColorItem && nextColorPicker && nextAlphaToggle) {
        nextColorItem.style.display = 'flex';
        nextColorPicker.value = newColor;
        nextAlphaToggle.dataset.alpha = '100';
        
        const icon = nextAlphaToggle.querySelector('i');
        if (icon) {
            icon.className = 'ri-eye-line';
        }
        nextColorPicker.classList.remove('transparent');
        
        domCache.colorItems = null;
        updateColorLabels();
        updateAddButtonState();
        invalidateColorCache();
        checkForCustomChanges();
        debouncedGenerateGradient();
    }
}

function generateDarkerColor(hexColor) {
    const rgb = hexToRgb(hexColor);
    if (!rgb) return hexColor;
    
    const factor = 0.7;
    const newR = Math.round(rgb.r * factor);
    const newG = Math.round(rgb.g * factor);
    const newB = Math.round(rgb.b * factor);
    
    return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
}

function removeColor(colorIndex) {
    const currentCount = getCurrentColorCount();
    if (currentCount <= 2) return;
    
    const colorsWithAlpha = [];
    for (let i = 0; i < currentCount; i++) {
        if (i !== colorIndex) {
            const colorPicker = domCache.getColorPicker(i);
            const alphaToggle = domCache.get(`alpha-toggle-${i}`);
            if (colorPicker && alphaToggle) {
                colorsWithAlpha.push({
                    hex: colorPicker.value,
                    alpha: parseInt(alphaToggle.dataset.alpha) / 100.0
                });
            }
        }
    }
    
    // Hide the last color item
    const lastColorItem = document.querySelector(`.color-item[data-color-index="${currentCount - 1}"]`);
    if (lastColorItem) {
        lastColorItem.style.display = 'none';
    }
    
    domCache.colorItems = null;
    
    colorsWithAlpha.forEach((colorData, index) => {
        const colorPicker = domCache.getColorPicker(index);
        const alphaToggle = domCache.get(`alpha-toggle-${index}`);
        if (colorPicker && alphaToggle) {
            colorPicker.value = colorData.hex;
            const alphaValue = Math.round(colorData.alpha * 100);
            alphaToggle.dataset.alpha = alphaValue.toString();
            
            const icon = alphaToggle.querySelector('i');
            if (icon) {
                icon.className = alphaValue === 0 ? 'ri-eye-off-line' : 'ri-eye-line';
            }
            
            if (alphaValue === 0) {
                colorPicker.classList.add('transparent');
            } else {
                colorPicker.classList.remove('transparent');
            }
        }
    });
    
    updateColorLabels();
    updateAddButtonState();
    invalidateColorCache();
    checkForCustomChanges();
    debouncedGenerateGradient();
}

let draggedElement = null;
let draggedIndex = -1;

function setupColorDragAndDrop() {
    const colorControls = document.getElementById('color-controls');
    const trashBin = document.getElementById('trash-bin');
    
    // Color controls events
    colorControls.addEventListener('dragstart', handleDragStart);
    colorControls.addEventListener('dragover', handleDragOver);
    colorControls.addEventListener('dragenter', handleDragEnter);
    colorControls.addEventListener('dragleave', handleDragLeave);
    colorControls.addEventListener('drop', handleDrop);
    colorControls.addEventListener('dragend', handleDragEnd);
    
    // Trash bin events
    if (trashBin) {
        trashBin.addEventListener('dragover', handleTrashDragOver);
        trashBin.addEventListener('dragenter', handleTrashDragEnter);
        trashBin.addEventListener('dragleave', handleTrashDragLeave);
        trashBin.addEventListener('drop', handleTrashDrop);
    }
}

function handleDragStart(e) {
    if (!e.target.classList.contains('color-item')) return;
    
    draggedElement = e.target;
    draggedIndex = parseInt(e.target.dataset.colorIndex);
    
    e.target.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', e.target.outerHTML);
}


function handleDragEnter(e) {
    const colorItem = e.target.closest('.color-item');
    if (colorItem && colorItem !== draggedElement) {
        updateDropIndicator(e, colorItem);
    }
}

function handleDragLeave(e) {
    const colorItem = e.target.closest('.color-item');
    if (colorItem) {
        colorItem.classList.remove('drag-over-left', 'drag-over-right');
    }
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    
    const colorItem = e.target.closest('.color-item');
    if (colorItem && colorItem !== draggedElement) {
        updateDropIndicator(e, colorItem);
    }
}

function updateDropIndicator(e, colorItem) {
    domCache.getColorItems().forEach(item => {
        item.classList.remove('drag-over-left', 'drag-over-right');
    });
    
    const rect = colorItem.getBoundingClientRect();
    const mouseX = e.clientX;
    const itemCenterX = rect.left + rect.width / 2;
    
    const draggedIdx = parseInt(draggedElement.dataset.colorIndex);
    const targetIdx = parseInt(colorItem.dataset.colorIndex);
    
    // Determine which side to show the indicator based on mouse position and drag direction
    if (mouseX < itemCenterX) {
        // Mouse is on the left side of the item
        if (draggedIdx > targetIdx) {
            // Dragging from right to left - show left indicator
            colorItem.classList.add('drag-over-left');
        } else {
            // Dragging from left to right - show left indicator (insert before)
            colorItem.classList.add('drag-over-left');
        }
    } else {
        // Mouse is on the right side of the item
        if (draggedIdx < targetIdx) {
            // Dragging from left to right - show right indicator
            colorItem.classList.add('drag-over-right');
        } else {
            // Dragging from right to left - show right indicator (insert after)
            colorItem.classList.add('drag-over-right');
        }
    }
}

function handleDrop(e) {
    e.preventDefault();
    
    const dropTarget = e.target.closest('.color-item');
    if (!dropTarget || dropTarget === draggedElement) return;
    
    const dropIndex = parseInt(dropTarget.dataset.colorIndex);
    const rect = dropTarget.getBoundingClientRect();
    const mouseX = e.clientX;
    const itemCenterX = rect.left + rect.width / 2;
    
    let finalDropIndex = dropIndex;
    
    // Adjust drop index based on which side of the item we're dropping on
    if (mouseX > itemCenterX && draggedIndex < dropIndex) {
        // Keep the original drop index (insert after the target)
    } else if (mouseX < itemCenterX && draggedIndex > dropIndex) {
        // Keep the original drop index (insert before the target)
    } else if (mouseX > itemCenterX && draggedIndex > dropIndex) {
        finalDropIndex = dropIndex + 1;
    } else if (mouseX < itemCenterX && draggedIndex < dropIndex) {
        finalDropIndex = dropIndex - 1;
    }
    
    reorderColors(draggedIndex, finalDropIndex);
    
    domCache.getColorItems().forEach(item => {
        item.classList.remove('drag-over-left', 'drag-over-right');
    });
}

function handleDragEnd(e) {
    if (e.target.classList.contains('color-item')) {
        e.target.classList.remove('dragging');
    }
    
    domCache.getColorItems().forEach(item => {
        item.classList.remove('drag-over-left', 'drag-over-right');
    });
    
    draggedElement = null;
    draggedIndex = -1;
}

function handleTrashDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
}

function handleTrashDragEnter(e) {
    e.target.closest('.trash-bin').classList.add('drag-over');
}

function handleTrashDragLeave(e) {
    e.target.closest('.trash-bin').classList.remove('drag-over');
}

function handleTrashDrop(e) {
    e.preventDefault();
    const trashBin = e.target.closest('.trash-bin');
    trashBin.classList.remove('drag-over');
    
    if (draggedElement && draggedIndex !== -1) {
        removeColor(draggedIndex);
    }
}

function reorderColors(fromIndex, toIndex) {
    const currentCount = getCurrentColorCount();
    
    if (fromIndex >= currentCount || toIndex >= currentCount) return;
    
    if (fromIndex === toIndex) return;
    
    const colors = [];
    for (let i = 0; i < currentCount; i++) {
        const colorPicker = domCache.getColorPicker(i);
        if (colorPicker) {
            colors.push(colorPicker.value);
        }
    }
    
    const [movedColor] = colors.splice(fromIndex, 1);
    colors.splice(toIndex, 0, movedColor);
    
    colors.forEach((color, index) => {
        const colorPicker = domCache.getColorPicker(index);
        if (colorPicker) {
            colorPicker.value = color;
        }
    });
    
    updateColorLabels();
    
    invalidateColorCache();
    checkForCustomChanges();
    debouncedGenerateGradient();
}

function updateColorLabels() {
    const colorItems = domCache.getColorItems();
    colorItems.forEach((item, index) => {
        const label = item.querySelector('label');
        if (label) {
            label.textContent = `${index + 1}.`;
        }
        item.dataset.colorIndex = index;
    });
}

function debouncedGenerateGradient() {
    if (generationTimeout) {
        clearTimeout(generationTimeout);
    }
    
    // Use requestAnimationFrame for better performance and frame alignment
    generationTimeout = setTimeout(() => {
        requestAnimationFrame(() => {
            generateGradientOptimized();
        });
    }, 8); // Reduced debounce time for more responsive UI
}

function generateGradientImmediate() {
    if (generationTimeout) {
        clearTimeout(generationTimeout);
    }
    generateGradientOptimized();
}

function generateGradientForced() {
    if (generationTimeout) {
        clearTimeout(generationTimeout);
    }
    
    lastParams = null;
    generateGradientOptimized();
}

async function generateGradientOptimized() {
    if (!gradientGenerator) return;
    
    if (isGenerating) {
        pendingGeneration = true;
        return;
    }
    
    try {
        isGenerating = true;
        updateResolutionStatus('Creating...', true);
        
        const params = collectParameters();
        const paramsString = JSON.stringify(params);
        
        if (paramsString === lastParams) {
            return;
        }
        
        
        if (!isApplyingHistory) {
            saveToHistory(params);
        }
        lastParams = paramsString;
        
        gradientGenerator.update_params(paramsString);
        
        const width = previewWidth;
        const height = previewHeight;
        
        const startTime = performance.now();
        const gradientData = gradientGenerator.generate_gradient_data(width, height);
        const wasmTime = performance.now();
        
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }
        
        const imageData = ctx.createImageData(width, height);
        imageData.data.set(gradientData);
        
        // Apply post-processing effects
        applyPostProcessing(imageData, params);
        
        ctx.putImageData(imageData, 0, 0);
        
        const endTime = performance.now();
        
        const wasmGenTime = Math.round(wasmTime - startTime);
        const totalTime = Math.round(endTime - startTime);
        updateResolutionStatus(`Preview ${width}×${height} • Export ${currentWidth}×${currentHeight} • ${wasmGenTime}ms`);
        
        updateCompositionDisplay();
        updateBackgroundCanvas();
        
    } catch (error) {
        console.error('Error generating gradient:', error);
        showError('Failed to generate gradient: ' + error.message);
        updateResolutionStatus('Generation failed', false);
    } finally {
        isGenerating = false;
        
        if (pendingGeneration) {
            pendingGeneration = false;
            setTimeout(() => generateGradientOptimized(), 10);
        }
    }
}

function applyPostProcessing(imageData, params, isExport = false) {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    
    const shadowsAdjust = (params.levels_shadows || 0) / 100;
    const midtonesAdjust = (params.levels_midtones || 0) / 100;
    const highlightsAdjust = (params.levels_highlights || 0) / 100;
    const hueShift = (params.hue_shift || 0) / 180 * Math.PI;
    const saturationAdjust = (params.saturation || 0) / 100;
    const noiseAmount = (params.noise_amount || 0) / 100;
    const noiseScale = params.noise_scale || 1.0;
    
    if (shadowsAdjust === 0 && midtonesAdjust === 0 && highlightsAdjust === 0 && 
        hueShift === 0 && saturationAdjust === 0 && noiseAmount === 0) {
        return;
    }
    
    const hasLevels = shadowsAdjust !== 0 || midtonesAdjust !== 0 || highlightsAdjust !== 0;
    const hasColor = hueShift !== 0 || saturationAdjust !== 0;
    const hasNoise = noiseAmount > 0;
    
    if (hasLevels && hasColor && hasNoise) {
        applyFullProcessing(data, width, height, shadowsAdjust, midtonesAdjust, highlightsAdjust, 
                          hueShift, saturationAdjust, noiseAmount, noiseScale);
    } else if (hasLevels && hasColor) {
        applyLevelsAndColor(data, shadowsAdjust, midtonesAdjust, highlightsAdjust, hueShift, saturationAdjust);
    } else if (hasLevels) {
        applyLevelsOnly(data, shadowsAdjust, midtonesAdjust, highlightsAdjust);
    } else if (hasColor) {
        applyColorOnly(data, hueShift, saturationAdjust);
    } else if (hasNoise) {
        applyNoiseOnly(data, width, height, noiseAmount, noiseScale);
    }
    
    if (hasLevels) {
        const levelsIntensity = Math.abs(shadowsAdjust) + Math.abs(midtonesAdjust) + Math.abs(highlightsAdjust);
        const threshold = isExport ? 0.1 : 0.3;
        if (levelsIntensity > threshold) {
            applyEdgeSmoothing(imageData, levelsIntensity, isExport);
        }
    }
}

function applyLevelsOnly(data, shadowsAdjust, midtonesAdjust, highlightsAdjust) {
    for (let i = 0; i < data.length; i += 4) {
        let r = data[i] / 255;
        let g = data[i + 1] / 255;
        let b = data[i + 2] / 255;
        
        const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
        let adjustment = 0;
        
        if (luminance < 0.33) {
            adjustment = shadowsAdjust * (1 - luminance / 0.33);
        } else if (luminance < 0.66) {
            adjustment = midtonesAdjust;
        } else {
            adjustment = highlightsAdjust * ((luminance - 0.66) / 0.34);
        }
        
        data[i] = Math.round(Math.max(0, Math.min(1, r + adjustment)) * 255);
        data[i + 1] = Math.round(Math.max(0, Math.min(1, g + adjustment)) * 255);
        data[i + 2] = Math.round(Math.max(0, Math.min(1, b + adjustment)) * 255);
    }
}

function applyColorOnly(data, hueShift, saturationAdjust) {
    const hueShiftNorm = hueShift / (2 * Math.PI);
    
    for (let i = 0; i < data.length; i += 4) {
        let r = data[i] / 255;
        let g = data[i + 1] / 255;
        let b = data[i + 2] / 255;
        
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const diff = max - min;
        const sum = max + min;
        const l = sum / 2;
        
        let h = 0, s = 0;
        
        if (diff !== 0) {
            s = l > 0.5 ? diff / (2 - sum) : diff / sum;
            
            if (max === r) h = ((g - b) / diff + (g < b ? 6 : 0)) / 6;
            else if (max === g) h = ((b - r) / diff + 2) / 6;
            else h = ((r - g) / diff + 4) / 6;
        }
        
        h = (h + hueShiftNorm) % 1;
        if (h < 0) h += 1;
        s = Math.max(0, Math.min(1, s + saturationAdjust));
        
        if (s === 0) {
            r = g = b = l;
        } else {
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            
            r = hue2rgb(p, q, h + 1/3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1/3);
        }
        
        data[i] = Math.round(r * 255);
        data[i + 1] = Math.round(g * 255);
        data[i + 2] = Math.round(b * 255);
    }
}

function applyNoiseOnly(data, width, height, noiseAmount, noiseScale) {
    for (let i = 0; i < data.length; i += 4) {
        const x = (i / 4) % width;
        const y = Math.floor((i / 4) / width);
        
        const noise = (Math.sin(x * noiseScale * 0.1) * Math.cos(y * noiseScale * 0.1) + 
                      Math.sin(x * noiseScale * 0.07) * Math.cos(y * noiseScale * 0.13)) * 0.5;
        const noiseValue = noise * noiseAmount * 0.1;
        
        data[i] = Math.round(Math.max(0, Math.min(1, data[i] / 255 + noiseValue)) * 255);
        data[i + 1] = Math.round(Math.max(0, Math.min(1, data[i + 1] / 255 + noiseValue)) * 255);
        data[i + 2] = Math.round(Math.max(0, Math.min(1, data[i + 2] / 255 + noiseValue)) * 255);
    }
}

function applyLevelsAndColor(data, shadowsAdjust, midtonesAdjust, highlightsAdjust, hueShift, saturationAdjust) {
    const hueShiftNorm = hueShift / (2 * Math.PI);
    
    for (let i = 0; i < data.length; i += 4) {
        let r = data[i] / 255;
        let g = data[i + 1] / 255;
        let b = data[i + 2] / 255;
        
        const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
        let adjustment = 0;
        
        if (luminance < 0.33) {
            adjustment = shadowsAdjust * (1 - luminance / 0.33);
        } else if (luminance < 0.66) {
            adjustment = midtonesAdjust;
        } else {
            adjustment = highlightsAdjust * ((luminance - 0.66) / 0.34);
        }
        
        r = Math.max(0, Math.min(1, r + adjustment));
        g = Math.max(0, Math.min(1, g + adjustment));
        b = Math.max(0, Math.min(1, b + adjustment));
        
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const diff = max - min;
        const sum = max + min;
        const l = sum / 2;
        
        let h = 0, s = 0;
        
        if (diff !== 0) {
            s = l > 0.5 ? diff / (2 - sum) : diff / sum;
            
            if (max === r) h = ((g - b) / diff + (g < b ? 6 : 0)) / 6;
            else if (max === g) h = ((b - r) / diff + 2) / 6;
            else h = ((r - g) / diff + 4) / 6;
        }
        
        h = (h + hueShiftNorm) % 1;
        if (h < 0) h += 1;
        s = Math.max(0, Math.min(1, s + saturationAdjust));
        
        if (s === 0) {
            r = g = b = l;
        } else {
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            
            r = hue2rgb(p, q, h + 1/3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1/3);
        }
        
        data[i] = Math.round(r * 255);
        data[i + 1] = Math.round(g * 255);
        data[i + 2] = Math.round(b * 255);
    }
}

function applyFullProcessing(data, width, height, shadowsAdjust, midtonesAdjust, highlightsAdjust, 
                            hueShift, saturationAdjust, noiseAmount, noiseScale) {
    const hueShiftNorm = hueShift / (2 * Math.PI);
    
    for (let i = 0; i < data.length; i += 4) {
        let r = data[i] / 255;
        let g = data[i + 1] / 255;
        let b = data[i + 2] / 255;
        
        const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
        let adjustment = 0;
        
        if (luminance < 0.33) {
            adjustment = shadowsAdjust * (1 - luminance / 0.33);
        } else if (luminance < 0.66) {
            adjustment = midtonesAdjust;
        } else {
            adjustment = highlightsAdjust * ((luminance - 0.66) / 0.34);
        }
        
        r = Math.max(0, Math.min(1, r + adjustment));
        g = Math.max(0, Math.min(1, g + adjustment));
        b = Math.max(0, Math.min(1, b + adjustment));
        
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const diff = max - min;
        const sum = max + min;
        const l = sum / 2;
        
        let h = 0, s = 0;
        
        if (diff !== 0) {
            s = l > 0.5 ? diff / (2 - sum) : diff / sum;
            
            if (max === r) h = ((g - b) / diff + (g < b ? 6 : 0)) / 6;
            else if (max === g) h = ((b - r) / diff + 2) / 6;
            else h = ((r - g) / diff + 4) / 6;
        }
        
        h = (h + hueShiftNorm) % 1;
        if (h < 0) h += 1;
        s = Math.max(0, Math.min(1, s + saturationAdjust));
        
        if (s === 0) {
            r = g = b = l;
        } else {
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            
            r = hue2rgb(p, q, h + 1/3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1/3);
        }
        
        const x = (i / 4) % width;
        const y = Math.floor((i / 4) / width);
        
        const noise = (Math.sin(x * noiseScale * 0.1) * Math.cos(y * noiseScale * 0.1) + 
                      Math.sin(x * noiseScale * 0.07) * Math.cos(y * noiseScale * 0.13)) * 0.5;
        const noiseValue = noise * noiseAmount * 0.1;
        
        r = Math.max(0, Math.min(1, r + noiseValue));
        g = Math.max(0, Math.min(1, g + noiseValue));
        b = Math.max(0, Math.min(1, b + noiseValue));
        
        data[i] = Math.round(r * 255);
        data[i + 1] = Math.round(g * 255);
        data[i + 2] = Math.round(b * 255);
    }
}

function hue2rgb(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
}

function applyEdgeSmoothing(imageData, intensity, isExport = false) {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    
    const smoothingStrength = isExport 
        ? Math.min(intensity * 0.8, 1.0)
        : Math.min(intensity * 0.5, 0.8);
    
    const lumR = 0.299 / 255;
    const lumG = 0.587 / 255;
    const lumB = 0.114 / 255;
    
    const contrastThreshold = isExport ? 0.1 : 0.15;
    const stride = width * 4;
    
    const rowBuffer = new Uint8ClampedArray(stride * 3);
    
    for (let y = 0; y < 3 && y < height; y++) {
        const srcOffset = y * stride;
        const dstOffset = y * stride;
        for (let i = 0; i < stride; i++) {
            rowBuffer[dstOffset + i] = data[srcOffset + i];
        }
    }
    
    for (let y = 1; y < height - 1; y++) {
        const currentRow = (y % 3) * stride;
        const prevRow = ((y - 1) % 3) * stride;
        const nextRow = ((y + 1) % 3) * stride;
        
        if (y + 2 < height) {
            const loadRow = (y + 2) % 3;
            const srcOffset = (y + 2) * stride;
            const dstOffset = loadRow * stride;
            for (let i = 0; i < stride; i++) {
                rowBuffer[dstOffset + i] = data[srcOffset + i];
            }
        }
        
        for (let x = 1; x < width - 1; x++) {
            const centerIdx = currentRow + x * 4;
            
            const centerLum = rowBuffer[centerIdx] * lumR + 
                            rowBuffer[centerIdx + 1] * lumG + 
                            rowBuffer[centerIdx + 2] * lumB;
            
            let maxContrast = 0;
            
            const offsets = [
                prevRow + (x - 1) * 4, prevRow + x * 4, prevRow + (x + 1) * 4,
                currentRow + (x - 1) * 4, currentRow + (x + 1) * 4,
                nextRow + (x - 1) * 4, nextRow + x * 4, nextRow + (x + 1) * 4
            ];
            
            for (let i = 0; i < 8; i++) {
                const idx = offsets[i];
                const neighborLum = rowBuffer[idx] * lumR + 
                                  rowBuffer[idx + 1] * lumG + 
                                  rowBuffer[idx + 2] * lumB;
                
                const contrast = Math.abs(centerLum - neighborLum);
                if (contrast > maxContrast) maxContrast = contrast;
            }
            
            if (maxContrast > contrastThreshold) {
                const blendFactor = Math.min((maxContrast * maxContrast) * smoothingStrength * 2, 0.6);
                
                let avgR = rowBuffer[centerIdx] * 4;
                let avgG = rowBuffer[centerIdx + 1] * 4;
                let avgB = rowBuffer[centerIdx + 2] * 4;
                
                const weights = [0.7, 1.0, 0.7, 1.0, 1.0, 0.7, 1.0, 0.7];
                
                for (let i = 0; i < 8; i++) {
                    const idx = offsets[i];
                    avgR += rowBuffer[idx] * weights[i];
                    avgG += rowBuffer[idx + 1] * weights[i];
                    avgB += rowBuffer[idx + 2] * weights[i];
                }
                
                const invTotalWeight = 1 / 10.8;
                avgR *= invTotalWeight;
                avgG *= invTotalWeight;
                avgB *= invTotalWeight;
                
                const invBlend = 1 - blendFactor;
                const dataIdx = y * stride + x * 4;
                data[dataIdx] = (rowBuffer[centerIdx] * invBlend + avgR * blendFactor) | 0;
                data[dataIdx + 1] = (rowBuffer[centerIdx + 1] * invBlend + avgG * blendFactor) | 0;
                data[dataIdx + 2] = (rowBuffer[centerIdx + 2] * invBlend + avgB * blendFactor) | 0;
            }
        }
    }
}

function updateResolutionStatus(message, isLoading = false) {
    const statusElement = domCache.get('resolution-status');
    if (statusElement) {
        statusElement.textContent = message;
        statusElement.style.color = isLoading ? '#ffa500' : '#888';
        statusElement.style.fontWeight = isLoading ? 'bold' : 'normal';
    }
}


function collectParameters() {
    const colorParams = getRgbColors();
    const activeColors = getActiveColors();
    
    return {
        seed: parseInt(domCache.get('seed')?.value || '42'),
        blend_mode: domCache.get('blend-mode')?.value || 'smooth',
        color_spread: parseFloat(domCache.get('color-spread')?.value || '0.7'),
        flow_intensity: parseFloat(domCache.get('flow-intensity')?.value || '0.3'),
        organic_distortion: parseFloat(domCache.get('organic-distortion')?.value || '0.2'),
        color_variance: parseFloat(domCache.get('color-variance')?.value || '0.1'),
        center_bias: parseFloat(domCache.get('center-bias')?.value || '0.5'),
        offset_x: canvasOffset.x,
        offset_y: canvasOffset.y,
        zoom: canvasZoom,
        canvas_rotation: canvasRotation,
        color_count: activeColors.length,
        levels_shadows: parseFloat(domCache.get('levels-shadows')?.value || '0'),
        levels_midtones: parseFloat(domCache.get('levels-midtones')?.value || '0'),
        levels_highlights: parseFloat(domCache.get('levels-highlights')?.value || '0'),
        hue_shift: parseFloat(domCache.get('hue-shift')?.value || '0'),
        saturation: parseFloat(domCache.get('saturation')?.value || '0'),
        noise_amount: parseFloat(domCache.get('noise-amount')?.value || '0'),
        noise_scale: parseFloat(domCache.get('noise-scale')?.value || '1.0'),
        ...colorParams
    };
}

function hexToRgb(hex) {
    if (hexToRgbCache.has(hex)) return hexToRgbCache.get(hex);
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    const rgb = result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
    hexToRgbCache.set(hex, rgb);
    return rgb;
}

function updateUIFromParams(params) {
    if (params.seed !== undefined) {
        document.getElementById('seed').value = params.seed;
        document.getElementById('seed-value').textContent = params.seed;
    }
    if (params.blend_mode !== undefined) {
        document.getElementById('blend-mode').value = params.blend_mode;
    }
    if (params.color_spread !== undefined) {
        document.getElementById('color-spread').value = params.color_spread;
        document.getElementById('color-spread-value').textContent = params.color_spread;
    }
    if (params.flow_intensity !== undefined) {
        document.getElementById('flow-intensity').value = params.flow_intensity;
        document.getElementById('flow-intensity-value').textContent = params.flow_intensity;
    }
    if (params.organic_distortion !== undefined) {
        document.getElementById('organic-distortion').value = params.organic_distortion;
        document.getElementById('organic-distortion-value').textContent = params.organic_distortion;
    }
    if (params.color_variance !== undefined) {
        document.getElementById('color-variance').value = params.color_variance;
        document.getElementById('color-variance-value').textContent = params.color_variance;
    }
    if (params.center_bias !== undefined) {
        document.getElementById('center-bias').value = params.center_bias;
        document.getElementById('center-bias-value').textContent = params.center_bias;
    }
    
}

async function exportImage() {
    if (!canvas) return;
    
    try {
        
        
        const params = collectParameters();
        const paramsString = JSON.stringify(params);
        gradientGenerator.update_params(paramsString);
        
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = currentWidth;
        exportCanvas.height = currentHeight;
        const exportCtx = exportCanvas.getContext('2d');
        
        const gradientData = gradientGenerator.generate_gradient_data(currentWidth, currentHeight);
        const imageData = exportCtx.createImageData(currentWidth, currentHeight);
        imageData.data.set(gradientData);
        
        // Apply post-processing effects for export with higher quality anti-aliasing
        applyPostProcessing(imageData, params, true);
        
        exportCtx.putImageData(imageData, 0, 0);
        
        const link = document.createElement('a');
        link.download = `gradient-${currentWidth}x${currentHeight}-${Date.now()}.png`;
        link.href = exportCanvas.toDataURL();
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        
    } catch (error) {
        console.error('Export failed:', error);
        showError('Failed to export image: ' + error.message);
    }
}

// Color presets shared between functions
const COLOR_PRESETS = {
    sunset: ['#2d0b00', '#ffb347', '#ff5e13', '#ffd580', '#6e00ff', '#00ffd0'],
    ocean: ['#0abde3', '#006ba6', '#0c2461', '#1e3799', '#74b9ff', '#00cec9'],
    forest: ['#00d2d3', '#54a0ff', '#5f27cd', '#00b894', '#55a3ff', '#26de81'],
    cosmic: ['#6c5ce7', '#fd79a8', '#a55eea', '#fff700', '#00fff7', '#e84393'],
    fire: ['#ff3838', '#ff9500', '#ffdd59', '#ff6348', '#e17055', '#d63031'],
    ice: ['#7bed9f', '#70a1ff', '#5352ed', '#40407a', '#74b9ff', '#a29bfe'],
    earth: ['#2c2c54', '#40407a', '#706fd3', '#f7f1e3', '#6c5ce7', '#fdcb6e'],
    neon: ['#ff006e', '#8338ec', '#3a86ff', '#06ffa5', '#fd79a8', '#fdcb6e']
};

function applyColorPreset(colorPresetName) {
    const colors = COLOR_PRESETS[colorPresetName];
    if (colors) {
        updateColorPickers(colors);
        generateGradientImmediate();
    }
}

function randomizeColors(seed) {
    const random = new SeededRandom(seed);
    const colorCount = getCurrentColorCount();
    const colors = [];
    
    for (let i = 0; i < colorCount; i++) {
        const hue = random.next() * 360;
        const saturation = 50 + random.next() * 50;
        const lightness = 30 + random.next() * 40;
        colors.push(hslToHex(hue, saturation, lightness));
    }
    
    updateColorPickers(colors);
    setToCustomPreset();
    generateGradientImmediate();
}

function updateColorPickers(colors) {
    colors.forEach((color, index) => {
        const colorPicker = domCache.getColorPicker(index);
        const alphaToggle = domCache.get(`alpha-toggle-${index}`);
        if (colorPicker) {
            if (typeof color === 'string') {
                // Legacy hex color format
                colorPicker.value = color;
                colorPicker.classList.remove('transparent');
                if (alphaToggle) {
                    alphaToggle.dataset.alpha = '100';
                    const icon = alphaToggle.querySelector('i');
                    if (icon) icon.className = 'ri-eye-line';
                }
            } else {
                // New format with alpha
                colorPicker.value = color.hex;
                if (alphaToggle) {
                    const alphaValue = Math.round(color.alpha * 100);
                    alphaToggle.dataset.alpha = alphaValue.toString();
                    const icon = alphaToggle.querySelector('i');
                    if (icon) {
                        icon.className = alphaValue === 0 ? 'ri-eye-off-line' : 'ri-eye-line';
                    }
                    
                    if (alphaValue === 0) {
                        colorPicker.classList.add('transparent');
                    } else {
                        colorPicker.classList.remove('transparent');
                    }
                }
            }
        }
    });
    invalidateColorCache();
}

function hslToHex(h, s, l) {
    l /= 100;
    const a = s * Math.min(l, 1 - l) / 100;
    const f = n => {
        const k = (n + h / 30) % 12;
        const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
}

class SeededRandom {
    constructor(seed) {
        this.seed = seed % 2147483647;
        if (this.seed <= 0) this.seed += 2147483646;
    }
    
    next() {
        this.seed = this.seed * 16807 % 2147483647;
        return (this.seed - 1) / 2147483646;
    }
}

function saveToHistory(params) {
    if (historyIndex < history.length - 1) {
        history = history.slice(0, historyIndex + 1);
    }
    
    history.push(JSON.parse(JSON.stringify(params)));
    
    if (history.length > MAX_HISTORY) {
        history.shift();
    } else {
        historyIndex++;
    }
    
    updateHistoryButtons();
}

function undo() {
    if (historyIndex > 0) {
        historyIndex--;
        const params = history[historyIndex];
        applyHistoryState(params);
    }
}

function redo() {
    if (historyIndex < history.length - 1) {
        historyIndex++;
        const params = history[historyIndex];
        applyHistoryState(params);
    }
}

function applyHistoryState(params) {
    if (gradientGenerator) {
        isApplyingHistory = true;
        
        gradientGenerator.update_params(JSON.stringify(params));
        updateUIFromParams(params);
        
        // Restore color states and visibility
        if (params.color_count !== undefined) {
            // Update color visibility based on saved color count
            updateColorControlsVisibility(params.color_count);
            
            // Restore individual color values and alpha states
            const colors = [];
            for (let i = 0; i < params.color_count; i++) {
                const colorKey = `color_${i + 1}`;
                if (params[colorKey]) {
                    const [r, g, b, a] = params[colorKey];
                    const hex = `#${Math.round(r * 255).toString(16).padStart(2, '0')}${Math.round(g * 255).toString(16).padStart(2, '0')}${Math.round(b * 255).toString(16).padStart(2, '0')}`;
                    colors.push({ hex, alpha: a });
                }
            }
            
            // Apply the restored colors
            updateColorPickers(colors);
            updateAddButtonState();
            invalidateColorCache();
        }
        
        lastParams = JSON.stringify(params);
        
        try {
            isGenerating = true;
            updateResolutionStatus('Applying...', true);
            
            const width = previewWidth;
            const height = previewHeight;
            const gradientData = gradientGenerator.generate_gradient_data(width, height);
            const imageData = new ImageData(new Uint8ClampedArray(gradientData), width, height);
            
            // Apply post-processing effects
            applyPostProcessing(imageData, params);
            
            if (canvas.width !== width || canvas.height !== height) {
                canvas.width = width;
                canvas.height = height;
            }
            
            ctx.putImageData(imageData, 0, 0);
            
            updateResolutionStatus('Applied from history');
        } catch (error) {
            console.error('Error applying history state:', error);
            updateResolutionStatus('History apply failed', false);
        } finally {
            isGenerating = false;
            isApplyingHistory = false; // Re-enable history saving
        }
        
        updateHistoryButtons();
    }
}

function updateHistoryButtons() {
    const undoBtn = domCache.get('undo');
    const redoBtn = domCache.get('redo');
    
    if (undoBtn) undoBtn.disabled = historyIndex <= 0;
    if (redoBtn) redoBtn.disabled = historyIndex >= history.length - 1;
}


function setupCanvasInteraction() {
    if (!canvas) return;
    
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseUp);
    
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd);
    
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    
}

function handleMouseDown(e) {
    isDragging = true;
    lastMousePos = getMousePos(e);
    canvas.style.cursor = 'grabbing';
}

function handleMouseMove(e) {
    if (!isDragging) return;
    
    const currentPos = getMousePos(e);
    const deltaX = currentPos.x - lastMousePos.x;
    const deltaY = currentPos.y - lastMousePos.y;
    
    canvasOffset.x -= deltaX / canvasZoom;
    canvasOffset.y -= deltaY / canvasZoom;
    
    lastMousePos = currentPos;
    
    updateCompositionDisplay();
    debouncedGenerateGradient();
}

function handleMouseUp(e) {
    isDragging = false;
    canvas.style.cursor = 'grab';
}

function handleWheel(e) {
    e.preventDefault();
    
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.1, Math.min(5.0, canvasZoom * zoomFactor));
    
    if (newZoom !== canvasZoom) {
        const zoomRatio = newZoom / canvasZoom;
        canvasOffset.x = mouseX - (mouseX - canvasOffset.x) * zoomRatio;
        canvasOffset.y = mouseY - (mouseY - canvasOffset.y) * zoomRatio;
        
        canvasZoom = newZoom;
        
        updateCompositionDisplay();
        debouncedGenerateGradient();
    }
}

function handleTouchStart(e) {
    e.preventDefault();
    if (e.touches.length === 1) {
        isDragging = true;
        lastMousePos = getTouchPos(e.touches[0]);
    }
}

function handleTouchMove(e) {
    e.preventDefault();
    if (!isDragging || e.touches.length !== 1) return;
    
    const currentPos = getTouchPos(e.touches[0]);
    const deltaX = currentPos.x - lastMousePos.x;
    const deltaY = currentPos.y - lastMousePos.y;
    
    canvasOffset.x -= deltaX / canvasZoom;
    canvasOffset.y -= deltaY / canvasZoom;
    
    lastMousePos = currentPos;
    
    updateCompositionDisplay();
    debouncedGenerateGradient();
}

function handleTouchEnd(e) {
    isDragging = false;
}

function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
    };
}

function getTouchPos(touch) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top
    };
}

function updateCompositionDisplay() {
    const offsetDisplay = domCache.get('composition-offset');
    const zoomDisplay = domCache.get('composition-zoom');
    
    if (offsetDisplay) {
        offsetDisplay.textContent = `Offset: ${Math.round(canvasOffset.x)}, ${Math.round(canvasOffset.y)}`;
    }
    if (zoomDisplay) {
        zoomDisplay.textContent = `Zoom: ${canvasZoom.toFixed(1)}x`;
    }
}

function updateBackgroundCanvas() {
    if (!canvas || !backgroundCanvas || !backgroundCtx) return;
    
    try {
        backgroundCanvas.width = window.innerWidth;
        backgroundCanvas.height = window.innerHeight;
        
        const scaleX = backgroundCanvas.width / canvas.width;
        const scaleY = backgroundCanvas.height / canvas.height;
        const scale = Math.max(scaleX, scaleY);
        
        const scaledWidth = canvas.width * scale;
        const scaledHeight = canvas.height * scale;
        const offsetX = (backgroundCanvas.width - scaledWidth) / 2;
        const offsetY = (backgroundCanvas.height - scaledHeight) / 2;
        
        backgroundCtx.clearRect(0, 0, backgroundCanvas.width, backgroundCanvas.height);
        backgroundCtx.drawImage(
            canvas,
            offsetX, offsetY,
            scaledWidth, scaledHeight
        );
        
    } catch (error) {
        console.warn('Failed to update background canvas:', error);
    }
}

function resetComposition() {
    canvasOffset = { x: 0, y: 0 };
    canvasZoom = 1.0;
    canvasRotation = 0;
    
    const rotationSlider = document.getElementById('canvas-rotation');
    const rotationValue = document.getElementById('canvas-rotation-value');
    if (rotationSlider) rotationSlider.value = 0;
    if (rotationValue) rotationValue.textContent = '0';
    
    updateCompositionDisplay();
    applyCanvasRotation();
    generateGradientForced();
}

function applyCanvasRotation() {
    debouncedGenerateGradient();
}


function randomizeBlending() {
    if (!gradientGenerator) return;
    
    try {
        updateResolutionStatus('Randomizing blending...', true);
        
        const randomSeed = Math.floor(Math.random() * 1000000);
        const random = new SeededRandom(randomSeed);
        const creativity = 0.8;
        
        document.getElementById('seed').value = randomSeed;
        document.getElementById('seed-value').textContent = randomSeed;
        
        const flowValue = random.next() * creativity;
        document.getElementById('flow-intensity').value = flowValue;
        document.getElementById('flow-intensity-value').textContent = flowValue.toFixed(2);
        
        const organicValue = random.next() * creativity;
        document.getElementById('organic-distortion').value = organicValue;
        document.getElementById('organic-distortion-value').textContent = organicValue.toFixed(2);
        
        const varianceValue = random.next() * creativity * 0.3;
        document.getElementById('color-variance').value = varianceValue;
        document.getElementById('color-variance-value').textContent = varianceValue.toFixed(2);
        
        const colorSpread = 0.5 + random.next() * creativity;
        document.getElementById('color-spread').value = colorSpread;
        document.getElementById('color-spread-value').textContent = colorSpread.toFixed(1);
        
        const blendModes = ['smooth', 'radial', 'angular', 'diamond', 'vortex'];
        const modeIndex = Math.floor(random.next() * blendModes.length);
        document.getElementById('blend-mode').value = blendModes[modeIndex];
        
        generateGradientImmediate();
        
    } catch (error) {
        console.error('Error with blending randomization:', error);
        updateResolutionStatus('Blending randomization failed', false);
    }
}


function handleAspectRatioChange() {
    const aspectRatio = document.getElementById('aspect-ratio').value;
    const dimensionControls = document.getElementById('dimension-controls');
    
    if (aspectRatio === 'custom') {
        dimensionControls.classList.remove('hidden');
    } else {
        dimensionControls.classList.add('hidden');
        
        const baseSize = 2000;
        let width, height;
        
        switch (aspectRatio) {
            case '16:9':
                width = baseSize;
                height = Math.round(baseSize * 9 / 16);
                break;
            case '4:3':
                width = baseSize;
                height = Math.round(baseSize * 3 / 4);
                break;
            case '3:2':
                width = baseSize;
                height = Math.round(baseSize * 2 / 3);
                break;
            case '21:9':
                width = baseSize;
                height = Math.round(baseSize * 9 / 21);
                break;
            case '9:16':
                width = Math.round(baseSize * 9 / 16);
                height = baseSize;
                break;
            case '3:4':
                width = Math.round(baseSize * 3 / 4);
                height = baseSize;
                break;
            case '2:3':
                width = Math.round(baseSize * 2 / 3);
                height = baseSize;
                break;
            default:
                width = baseSize;
                height = baseSize;
                break;
        }
        
        document.getElementById('width').value = width;
        document.getElementById('height').value = height;
        
        applyDimensionsInternal(width, height);
    }
}

function applyDimensions() {
    const width = parseInt(document.getElementById('width').value);
    const height = parseInt(document.getElementById('height').value);
    applyDimensionsInternal(width, height);
}

function applyDimensionsInternal(width, height) {
    currentWidth = width;
    currentHeight = height;
    
    updatePreviewResolution();
    
    canvas.width = width;
    canvas.height = height;
    
    
    ctx.clearRect(0, 0, width, height);
    
    setupResponsiveCanvas();
    
    generateGradientForced();
}

function showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #ff4444;
        color: white;
        padding: 15px;
        border-radius: 5px;
        z-index: 10000;
        max-width: 300px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `;
    errorDiv.textContent = message;
    document.body.appendChild(errorDiv);
    
    setTimeout(() => {
        if (errorDiv.parentNode) {
            errorDiv.parentNode.removeChild(errorDiv);
        }
    }, 5000);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}