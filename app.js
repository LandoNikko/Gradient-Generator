
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

async function init() {
    try {
        console.log('Initializing Gradient Generator...');
        
        wasmModule = await import('./pkg/gradient_noise_wasm.js');
        await wasmModule.default();
        
        gradientGenerator = new wasmModule.GradientGenerator();
        
        canvas = document.getElementById('canvas');
        ctx = canvas.getContext('2d');
        backgroundCanvas = document.getElementById('background-canvas');
        backgroundCtx = backgroundCanvas.getContext('2d');
        
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
    
    document.querySelectorAll('.color-preset-button').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const colorPreset = e.target.dataset.colorPreset;
            applyColorPreset(colorPreset);
        });
    });
    
    document.getElementById('randomize-colors')?.addEventListener('click', () => {
        const randomSeed = Math.floor(Math.random() * 10000);
        randomizeColors(randomSeed);
    });
    
    document.getElementById('randomize-everything')?.addEventListener('click', randomizeEverything);
    document.getElementById('undo')?.addEventListener('click', undo);
    document.getElementById('redo')?.addEventListener('click', redo);
    document.getElementById('apply-dimensions')?.addEventListener('click', applyDimensions);
    document.getElementById('reset-composition')?.addEventListener('click', resetComposition);
    document.getElementById('advanced-randomize')?.addEventListener('click', () => advancedRandomize(0.9));
    
    updateHistoryButtons();
    setupCanvasInteraction();
    updateGradientAngleVisibility();
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
    let currentColors = {
        color_1: [1.0, 0.4, 0.2],
        color_2: [0.2, 0.2, 0.3],
        color_3: [0.6, 0.8, 0.9],
        color_4: [0.1, 0.1, 0.1],
    };
    
    if (gradientGenerator) {
        try {
            const paramsJson = gradientGenerator.get_params_json();
            const currentParams = JSON.parse(paramsJson);
            if (currentParams.color_1) currentColors.color_1 = currentParams.color_1;
            if (currentParams.color_2) currentColors.color_2 = currentParams.color_2;
            if (currentParams.color_3) currentColors.color_3 = currentParams.color_3;
            if (currentParams.color_4) currentColors.color_4 = currentParams.color_4;
        } catch (e) {
            console.log('Using default colors');
        }
    }
    
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
        ...currentColors
    };
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
    if (!gradientGenerator) return;
    
    try {
        gradientGenerator.apply_color_preset(colorPresetName);
        
        generateGradientImmediate();
        
        console.log(`Applied color preset: ${colorPresetName}`);
    } catch (error) {
        console.error('Error applying color preset:', error);
    }
}

function randomizeColors(seed) {
    if (!gradientGenerator) return;
    
    try {
        gradientGenerator.randomize_colors(seed);
        
        generateGradientImmediate();
        
        console.log(`Randomized colors with seed: ${seed}`);
    } catch (error) {
        console.error('Error randomizing colors:', error);
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
        gradientGenerator.randomize_with_advanced_rng(randomSeed, creativityLevel);
        
        const paramsJson = gradientGenerator.get_params_json();
        const params = JSON.parse(paramsJson);
        updateUIFromParams(params);
        
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