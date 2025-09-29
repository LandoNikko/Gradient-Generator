
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

async function init() {
    try {
        console.log('Initializing Gradient Generator...');
        
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
        
        window.addEventListener('resize', () => {
            updateBackgroundCanvas();
        });
        
        console.log('Gradient Generator initialized successfully');
        
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
        
        console.log(`Canvas resized to ${Math.round(displayWidth)}x${Math.round(displayHeight)}px display (${canvas.width}x${canvas.height}px internal)`);
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
        'color-variance', 'gradient-angle', 'center-bias', 'width', 'height', 'canvas-rotation'
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
            updateGradientAngleVisibility();
            debouncedGenerateGradient();
        });
    }
    
    const aspectRatioSelect = document.getElementById('aspect-ratio');
    if (aspectRatioSelect) {
        aspectRatioSelect.addEventListener('change', handleAspectRatioChange);
    }
    document.getElementById('randomize')?.addEventListener('click', () => {
        const newSeed = Math.floor(Math.random() * 10000);
        document.getElementById('seed').value = newSeed;
        document.getElementById('seed-value').textContent = newSeed;
        generateGradientImmediate();
    });
    
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
    
    // Color picker and alpha toggle event listeners
    for (let i = 0; i < 6; i++) {
        const colorPicker = document.getElementById(`color-${i}`);
        const alphaToggle = document.getElementById(`alpha-toggle-${i}`);
        
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
                    e.stopPropagation(); // Prevent drag from starting
                    toggleAlpha(index);
                };
            })(i));
        }
    }
    
    document.getElementById('randomize-everything')?.addEventListener('click', randomizeEverything);
    document.getElementById('undo')?.addEventListener('click', undo);
    document.getElementById('redo')?.addEventListener('click', redo);
    document.getElementById('apply-dimensions')?.addEventListener('click', applyDimensions);
    document.getElementById('reset-composition')?.addEventListener('click', resetComposition);
    document.getElementById('advanced-randomize')?.addEventListener('click', () => advancedRandomize(0.9));
    
    updateHistoryButtons();
    setupCanvasInteraction();
    updateGradientAngleVisibility();
    initializeColors(); // Initialize with 2 colors
    setupColorDragAndDrop();
    setupAddColorButton();
    setupDropdownNavigation();
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
}

function getActiveColors() {
    const colorCount = getCurrentColorCount();
    
    if (colorCache && colorCache.count === colorCount && colorCache.version === colorCacheVersion) {
        return colorCache.colors;
    }
    
    const colors = [];
    for (let i = 0; i < colorCount; i++) {
        const colorPicker = document.getElementById(`color-${i}`);
        const alphaToggle = document.getElementById(`alpha-toggle-${i}`);
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
    const alphaToggle = document.getElementById(`alpha-toggle-${colorIndex}`);
    if (!alphaToggle) return;
    
    const currentAlpha = parseInt(alphaToggle.dataset.alpha);
    const newAlpha = currentAlpha === 100 ? 0 : 100;
    
    alphaToggle.dataset.alpha = newAlpha;
    
    const icon = alphaToggle.querySelector('i');
    if (icon) {
        if (newAlpha === 0) {
            icon.className = 'ri-eye-off-line';
        } else {
            icon.className = 'ri-eye-line';
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
    if (!currentPreset) return;
    
    const activeColors = getActiveColors();
    const hasChanged = activeColors.length !== presetColors.length || 
                      activeColors.some((color, index) => color !== presetColors[index]);
    
    if (hasChanged) {
        currentPreset = 'custom';
        const presetSelect = document.getElementById('color-preset');
        if (presetSelect) {
            // Add custom option if it doesn't exist
            let customOption = presetSelect.querySelector('option[value="custom"]');
            if (!customOption) {
                customOption = document.createElement('option');
                customOption.value = 'custom';
                customOption.textContent = 'Custom';
                presetSelect.insertBefore(customOption, presetSelect.children[1]);
            }
            presetSelect.value = 'custom';
        }
    }
}

function resetToNoPreset() {
    currentPreset = '';
    presetColors = [];
    const presetSelect = document.getElementById('color-preset');
    if (presetSelect) {
        // Remove custom option if it exists
        const customOption = presetSelect.querySelector('option[value="custom"]');
        if (customOption) {
            customOption.remove();
        }
        presetSelect.value = '';
    }
}

function initializeColors() {
    updateColorControlsVisibility(2);
    updateAddButtonState();
}

function getCurrentColorCount() {
    const colorItems = document.querySelectorAll('.color-item');
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
            const randomSeed = Math.floor(Math.random() * 10000);
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
    let newIndex;
    
    if (direction === 'prev') {
        newIndex = currentIndex > 0 ? currentIndex - 1 : options.length - 1;
    } else if (direction === 'next') {
        newIndex = currentIndex < options.length - 1 ? currentIndex + 1 : 0;
    }
    
    if (newIndex !== undefined && newIndex !== currentIndex) {
        dropdown.selectedIndex = newIndex;
        
        // Trigger change event
        const changeEvent = new Event('change', { bubbles: true });
        dropdown.dispatchEvent(changeEvent);
    }
}

function addColor() {
    const currentCount = getCurrentColorCount();
    if (currentCount >= 6) return;
    
    // Get the last visible color
    const lastColorPicker = document.getElementById(`color-${currentCount - 1}`);
    let newColor = '#ff6b6b'; // fallback
    
    if (lastColorPicker) {
        newColor = generateDarkerColor(lastColorPicker.value);
    }
    
    // Show the next color item and set its value
    const nextColorPicker = document.getElementById(`color-${currentCount}`);
    const nextAlphaToggle = document.getElementById(`alpha-toggle-${currentCount}`);
    const nextColorItem = nextColorPicker?.closest('.color-item');
    
    if (nextColorItem && nextColorPicker && nextAlphaToggle) {
        nextColorItem.style.display = 'grid';
        nextColorPicker.value = newColor;
        nextAlphaToggle.dataset.alpha = '100'; // Default to fully opaque
        
        // Ensure the icon is set to visible state
        const icon = nextAlphaToggle.querySelector('i');
        if (icon) {
            icon.className = 'ri-eye-line';
        }
        
        updateColorLabels();
        updateAddButtonState();
        invalidateColorCache();
        checkForCustomChanges();
        debouncedGenerateGradient();
    }
}

function generateDarkerColor(hexColor) {
    // Convert hex to RGB
    const rgb = hexToRgb(hexColor);
    if (!rgb) return hexColor;
    
    // Make it darker by reducing each component by 20-40%
    const factor = 0.7; // Make it 30% darker
    const newR = Math.round(rgb.r * factor);
    const newG = Math.round(rgb.g * factor);
    const newB = Math.round(rgb.b * factor);
    
    // Convert back to hex
    return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
}

function removeColor(colorIndex) {
    const currentCount = getCurrentColorCount();
    if (currentCount <= 2) return; // Don't allow removing if only 2 colors left
    
    // Get all current colors
    const colors = [];
    for (let i = 0; i < currentCount; i++) {
        if (i !== colorIndex) {
            const colorPicker = document.getElementById(`color-${i}`);
            if (colorPicker) {
                colors.push(colorPicker.value);
            }
        }
    }
    
    // Hide the last color item
    const lastColorItem = document.querySelector(`.color-item[data-color-index="${currentCount - 1}"]`);
    if (lastColorItem) {
        lastColorItem.style.display = 'none';
    }
    
    // Redistribute remaining colors
    colors.forEach((color, index) => {
        const colorPicker = document.getElementById(`color-${index}`);
        if (colorPicker) {
            colorPicker.value = color;
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
    // Remove existing indicators
    document.querySelectorAll('.color-item').forEach(item => {
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
        // Dropping on the right side when dragging left to right
        // Keep the original drop index (insert after the target)
    } else if (mouseX < itemCenterX && draggedIndex > dropIndex) {
        // Dropping on the left side when dragging right to left  
        // Keep the original drop index (insert before the target)
    } else if (mouseX > itemCenterX && draggedIndex > dropIndex) {
        // Dropping on the right side when dragging right to left
        finalDropIndex = dropIndex + 1;
    } else if (mouseX < itemCenterX && draggedIndex < dropIndex) {
        // Dropping on the left side when dragging left to right
        finalDropIndex = dropIndex - 1;
    }
    
    // Reorder the colors
    reorderColors(draggedIndex, finalDropIndex);
    
    // Clean up visual states
    document.querySelectorAll('.color-item').forEach(item => {
        item.classList.remove('drag-over-left', 'drag-over-right');
    });
}

function handleDragEnd(e) {
    if (e.target.classList.contains('color-item')) {
        e.target.classList.remove('dragging');
    }
    
    document.querySelectorAll('.color-item').forEach(item => {
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
    
    // Only reorder within visible colors
    if (fromIndex >= currentCount || toIndex >= currentCount) return;
    
    // Get all current color values
    const colors = [];
    for (let i = 0; i < currentCount; i++) {
        const colorPicker = document.getElementById(`color-${i}`);
        if (colorPicker) {
            colors.push(colorPicker.value);
        }
    }
    
    // Reorder the array
    const [movedColor] = colors.splice(fromIndex, 1);
    colors.splice(toIndex, 0, movedColor);
    
    // Update the color pickers with new order
    colors.forEach((color, index) => {
        const colorPicker = document.getElementById(`color-${index}`);
        if (colorPicker) {
            colorPicker.value = color;
        }
    });
    
    // Update labels to reflect new order
    updateColorLabels();
    
    // Invalidate cache and regenerate
    invalidateColorCache();
    checkForCustomChanges();
    debouncedGenerateGradient();
}

function updateColorLabels() {
    const colorItems = document.querySelectorAll('.color-item');
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
    
    generationTimeout = setTimeout(() => {
        generateGradientOptimized();
    }, 16); // ~60fps
}

function generateGradientImmediate() {
    if (generationTimeout) {
        clearTimeout(generationTimeout);
    }
    console.log(`Generating gradient immediately with dimensions: ${currentWidth}x${currentHeight}`);
    generateGradientOptimized();
}

function generateGradientForced() {
    if (generationTimeout) {
        clearTimeout(generationTimeout);
    }
    console.log(`Force generating gradient with dimensions: ${currentWidth}x${currentHeight}`);
    
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
            console.log('Skipping generation - parameters unchanged');
            return;
        }
        
        console.log('Parameters changed, proceeding with generation');
        
        if (!isApplyingHistory) {
            saveToHistory(params);
        }
        lastParams = paramsString;
        
        gradientGenerator.update_params(paramsString);
        
        const width = currentWidth;
        const height = currentHeight;
        
        const startTime = performance.now();
        const gradientData = gradientGenerator.generate_gradient_data(width, height);
        const wasmTime = performance.now();
        
        const imageData = ctx.createImageData(width, height);
        imageData.data.set(gradientData);
        ctx.putImageData(imageData, 0, 0);
        
        const endTime = performance.now();
        
        const wasmGenTime = Math.round(wasmTime - startTime);
        const totalTime = Math.round(endTime - startTime);
        updateResolutionStatus(`Generated in ${wasmGenTime}ms (${totalTime}ms total)`);
        
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

function updateResolutionStatus(message, isLoading = false) {
    const statusElement = document.getElementById('resolution-status');
    if (statusElement) {
        statusElement.textContent = message;
        statusElement.style.color = isLoading ? '#ffa500' : '#888';
        statusElement.style.fontWeight = isLoading ? 'bold' : 'normal';
    }
}

function updateGradientAngleVisibility() {
    const blendModeSelect = document.getElementById('blend-mode');
    const gradientAngleControl = document.getElementById('gradient-angle-control');
    
    if (blendModeSelect && gradientAngleControl) {
        const blendMode = blendModeSelect.value;
        const isSmooth = blendMode === 'smooth';
        
        if (isSmooth) {
            gradientAngleControl.classList.remove('hidden');
        } else {
            gradientAngleControl.classList.add('hidden');
        }
    }
}

function collectParameters() {
    const colorParams = getRgbColors();
    const activeColors = getActiveColors();
    
    return {
        seed: parseInt(document.getElementById('seed')?.value || '42'),
        blend_mode: document.getElementById('blend-mode')?.value || 'smooth',
        color_spread: parseFloat(document.getElementById('color-spread')?.value || '0.7'),
        flow_intensity: parseFloat(document.getElementById('flow-intensity')?.value || '0.3'),
        organic_distortion: parseFloat(document.getElementById('organic-distortion')?.value || '0.2'),
        color_variance: parseFloat(document.getElementById('color-variance')?.value || '0.1'),
        gradient_angle: parseFloat(document.getElementById('gradient-angle')?.value || '45'),
        center_bias: parseFloat(document.getElementById('center-bias')?.value || '0.5'),
        offset_x: canvasOffset.x,
        offset_y: canvasOffset.y,
        zoom: canvasZoom,
        canvas_rotation: canvasRotation,
        color_count: activeColors.length,
        ...colorParams
    };
}

function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
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
    if (params.gradient_angle !== undefined) {
        document.getElementById('gradient-angle').value = params.gradient_angle;
        document.getElementById('gradient-angle-value').textContent = params.gradient_angle;
    }
    if (params.center_bias !== undefined) {
        document.getElementById('center-bias').value = params.center_bias;
        document.getElementById('center-bias-value').textContent = params.center_bias;
    }
    
    updateGradientAngleVisibility();
}

async function exportImage() {
    if (!canvas) return;
    
    try {
        console.log('Exporting gradient...');
        
        const link = document.createElement('a');
        link.download = `gradient-${canvas.width}x${canvas.height}-${Date.now()}.png`;
        link.href = canvas.toDataURL();
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        console.log(`Gradient exported successfully at ${canvas.width}x${canvas.height}px`);
    } catch (error) {
        console.error('Export failed:', error);
        showError('Failed to export image: ' + error.message);
    }
}

function applyColorPreset(colorPresetName) {
    const presets = {
        sunset: ['#ff6b6b', '#ff8e53', '#ff6b9d', '#c44569', '#fd79a8', '#e17055'],
        ocean: ['#0abde3', '#006ba6', '#0c2461', '#1e3799', '#74b9ff', '#00cec9'],
        forest: ['#00d2d3', '#54a0ff', '#5f27cd', '#00b894', '#55a3ff', '#26de81'],
        cosmic: ['#a55eea', '#26de81', '#fd79a8', '#fdcb6e', '#6c5ce7', '#e84393'],
        fire: ['#ff3838', '#ff9500', '#ffdd59', '#ff6348', '#e17055', '#d63031'],
        ice: ['#7bed9f', '#70a1ff', '#5352ed', '#40407a', '#74b9ff', '#a29bfe'],
        earth: ['#2c2c54', '#40407a', '#706fd3', '#f7f1e3', '#6c5ce7', '#fdcb6e'],
        neon: ['#ff006e', '#8338ec', '#3a86ff', '#06ffa5', '#fd79a8', '#fdcb6e']
    };
    
    const colors = presets[colorPresetName];
    if (colors) {
        updateColorPickers(colors);
        generateGradientImmediate();
        console.log(`Applied color preset: ${colorPresetName}`);
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
    resetToNoPreset(); // Reset preset when randomizing
    generateGradientImmediate();
    console.log(`Randomized colors with seed: ${seed}`);
}

function updateColorPickers(colors) {
    colors.forEach((color, index) => {
        const colorPicker = document.getElementById(`color-${index}`);
        const alphaToggle = document.getElementById(`alpha-toggle-${index}`);
        if (colorPicker) {
            if (typeof color === 'string') {
                // Legacy hex color format
                colorPicker.value = color;
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
        console.log(`↶ Undo to state ${historyIndex + 1}`);
    }
}

function redo() {
    if (historyIndex < history.length - 1) {
        historyIndex++;
        const params = history[historyIndex];
        applyHistoryState(params);
        console.log(`↷ Redo to state ${historyIndex + 1}`);
    }
}

function applyHistoryState(params) {
    if (gradientGenerator) {
        isApplyingHistory = true;
        
        gradientGenerator.update_params(JSON.stringify(params));
        updateUIFromParams(params);
        
        lastParams = JSON.stringify(params);
        
        try {
            isGenerating = true;
            updateResolutionStatus('Applying...', true);
            
            const width = currentWidth;
            const height = currentHeight;
            const gradientData = gradientGenerator.generate_gradient_data(width, height);
            const imageData = new ImageData(new Uint8ClampedArray(gradientData), width, height);
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
    const undoBtn = document.getElementById('undo');
    const redoBtn = document.getElementById('redo');
    
    if (undoBtn) undoBtn.disabled = historyIndex <= 0;
    if (redoBtn) redoBtn.disabled = historyIndex >= history.length - 1;
}

function randomizeEverything() {
    if (!gradientGenerator) return;
    
    try {
        const randomSeed = Math.floor(Math.random() * 10000);
        
        gradientGenerator.randomize_colors(randomSeed);
        
        const randomParams = {
            seed: randomSeed,
            blend_mode: ['smooth', 'radial', 'angular', 'diamond'][Math.floor(Math.random() * 4)],
            color_spread: Math.round((0.3 + Math.random() * 1.4) * 10) / 10,
            flow_intensity: Math.round(Math.random() * 0.8 * 20) / 20,
            organic_distortion: Math.round(Math.random() * 0.6 * 20) / 20,
            color_variance: Math.round(Math.random() * 0.2 * 100) / 100,
            gradient_angle: Math.round(Math.random() * 360 / 5) * 5,
            center_bias: Math.round(Math.random() * 100) / 100
        };
        
        updateUIFromParams(randomParams);
        
        Object.keys(randomParams).forEach(key => {
            const element = document.getElementById(key.replace('_', '-'));
            if (element) {
                element.value = randomParams[key];
                const valueDisplay = document.getElementById(`${key.replace('_', '-')}-value`);
                if (valueDisplay) {
                    valueDisplay.textContent = randomParams[key];
                }
            }
        });
        
        generateGradientImmediate();
        
        console.log(`Randomized everything with seed: ${randomSeed}`);
    } catch (error) {
        console.error('Error randomizing:', error);
    }
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
    
    console.log('Canvas interaction setup complete');
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
    const offsetDisplay = document.getElementById('composition-offset');
    const zoomDisplay = document.getElementById('composition-zoom');
    
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
    console.log(`Canvas content rotated to ${canvasRotation} degrees`);
}


function advancedRandomize(creativityLevel) {
    if (!gradientGenerator) return;
    
    try {
        console.log(`Advanced randomization with creativity level ${creativityLevel}`);
        updateResolutionStatus('Advanced randomizing...', true);
        
        const randomSeed = Math.floor(Math.random() * 10000);
        const random = new SeededRandom(randomSeed);
        const creativity = Math.max(0, Math.min(1, creativityLevel));
        
        // Randomize parameters
        document.getElementById('flow-intensity').value = random.next() * creativity;
        document.getElementById('flow-intensity-value').textContent = (random.next() * creativity).toFixed(2);
        
        document.getElementById('organic-distortion').value = random.next() * creativity;
        document.getElementById('organic-distortion-value').textContent = (random.next() * creativity).toFixed(2);
        
        document.getElementById('color-variance').value = random.next() * creativity * 0.3;
        document.getElementById('color-variance-value').textContent = (random.next() * creativity * 0.3).toFixed(2);
        
        const colorSpread = 0.5 + random.next() * creativity;
        document.getElementById('color-spread').value = colorSpread;
        document.getElementById('color-spread-value').textContent = colorSpread.toFixed(1);
        
        // Randomize colors
        const colorCount = getCurrentColorCount();
        const colors = [];
        
        for (let i = 0; i < colorCount; i++) {
            const hue = random.next() * 360;
            const saturation = 40 + random.next() * 60 * creativity;
            const lightness = i % 2 === 0 ? 20 + random.next() * 50 : 50 + random.next() * 50;
            colors.push(hslToHex(hue, saturation, lightness));
        }
        
        updateColorPickers(colors);
        
        // Randomize blend mode
        const blendModes = ['smooth', 'radial', 'angular', 'diamond', 'vortex'];
        const modeIndex = Math.floor(random.next() * blendModes.length);
        document.getElementById('blend-mode').value = blendModes[modeIndex];
        
        generateGradientImmediate();
        
    } catch (error) {
        console.error('Error with advanced randomization:', error);
        updateResolutionStatus('Advanced randomization failed', false);
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
            default: // 1:1
                width = baseSize;
                height = baseSize;
                break;
        }
        
        document.getElementById('width').value = width;
        document.getElementById('height').value = height;
        document.getElementById('width-value').textContent = width;
        document.getElementById('height-value').textContent = height;
        
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
    
    canvas.width = width;
    canvas.height = height;
    
    console.log(`Canvas dimensions updated to ${width}x${height}px`);
    
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