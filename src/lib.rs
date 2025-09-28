use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use std::f64::consts::PI;
use rayon::prelude::*;
use rand::{Rng, SeedableRng};
use rand_xoshiro::Xoshiro256PlusPlus;

#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

#[derive(Serialize, Deserialize, Clone)]
pub struct GradientParams {
    pub seed: u32,
    pub blend_mode: String,
    pub color_spread: f64,
    pub flow_intensity: f64,
    pub organic_distortion: f64,
    pub color_variance: f64,
    pub gradient_angle: f64,
    pub center_bias: f64,
    pub offset_x: f64,
    pub offset_y: f64,
    pub zoom: f64,
    pub canvas_rotation: f64,
    pub color_1: [f64; 3],
    pub color_2: [f64; 3],
    pub color_3: [f64; 3],
    pub color_4: [f64; 3],
}

impl Default for GradientParams {
    fn default() -> Self {
        Self {
            seed: 42,
            blend_mode: "smooth".to_string(),
            color_spread: 0.7,
            flow_intensity: 0.3,
            organic_distortion: 0.2,
            color_variance: 0.1,
            gradient_angle: 45.0,
            center_bias: 0.5,
            offset_x: 0.0,
            offset_y: 0.0,
            zoom: 1.0,
            canvas_rotation: 0.0,
            color_1: [1.0, 0.4, 0.2],
            color_2: [0.2, 0.2, 0.3],
            color_3: [0.6, 0.8, 0.9],
            color_4: [0.1, 0.1, 0.1],
        }
    }
}

#[derive(Clone, Copy)]
pub enum BlendMode {
    Smooth = 0,
    Radial = 1,
    Angular = 2,
    Diamond = 3,
    Vortex = 4,
}

impl BlendMode {
    fn from_string(s: &str) -> Self {
        match s {
            "radial" => BlendMode::Radial,
            "angular" => BlendMode::Angular,
            "diamond" => BlendMode::Diamond,
            "vortex" => BlendMode::Vortex,
            _ => BlendMode::Smooth,
        }
    }
}

#[wasm_bindgen]
pub struct GradientGenerator {
    params: GradientParams,
    blend_mode_cached: BlendMode,
    color_cache: [[f64; 3]; 4],
    sin_table: Vec<f64>,
    cos_table: Vec<f64>,
    cached_constants: CachedConstants,
}

#[derive(Clone)]
struct CachedConstants {
    two_pi: f64,
    inv_two_pi: f64,
    pi_over_180: f64,
    table_size_f64: f64,
    table_size_mask: usize,
    organic_multipliers: [f64; 8],
    flow_multipliers: [f64; 4],
}

#[wasm_bindgen]
impl GradientGenerator {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        const TABLE_SIZE: usize = 8192;
        const TABLE_SIZE_MASK: usize = TABLE_SIZE - 1;
        
        let mut sin_table = Vec::with_capacity(TABLE_SIZE);
        let mut cos_table = Vec::with_capacity(TABLE_SIZE);
        
        let angles: Vec<f64> = (0..TABLE_SIZE)
            .into_par_iter()
            .map(|i| (i as f64) * 2.0 * PI / (TABLE_SIZE as f64))
            .collect();
        
        let sin_values: Vec<f64> = angles.par_iter().map(|&angle| angle.sin()).collect();
        let cos_values: Vec<f64> = angles.par_iter().map(|&angle| angle.cos()).collect();
        
        sin_table.extend(sin_values.iter());
        cos_table.extend(cos_values.iter());
        
        
        let cached_constants = CachedConstants {
            two_pi: 2.0 * PI,
            inv_two_pi: 1.0 / (2.0 * PI),
            pi_over_180: PI / 180.0,
            table_size_f64: TABLE_SIZE as f64,
            table_size_mask: TABLE_SIZE_MASK,
            organic_multipliers: [3.0, 2.5, 1.8, 4.2, 5.1, 1.3, 7.3, 5.7],
            flow_multipliers: [2.0, 2.0, 0.1, 0.2],
        };
        
        let default_params = GradientParams::default();
        let blend_mode_cached = BlendMode::from_string(&default_params.blend_mode);
        let color_cache = [
            default_params.color_1,
            default_params.color_2,
            default_params.color_3,
            default_params.color_4,
        ];
        
        Self {
            params: default_params,
            blend_mode_cached,
            color_cache,
            sin_table,
            cos_table,
            cached_constants,
        }
    }

    #[wasm_bindgen]
    pub fn update_params(&mut self, params_json: &str) -> Result<(), JsValue> {
        match serde_json::from_str::<GradientParams>(params_json) {
            Ok(params) => {
                self.blend_mode_cached = BlendMode::from_string(&params.blend_mode);
                self.color_cache = [params.color_1, params.color_2, params.color_3, params.color_4];
                self.params = params;
                Ok(())
            }
            Err(e) => Err(JsValue::from_str(&format!("Failed to parse params: {}", e))),
        }
    }

    #[inline(always)]
    fn ultra_fast_sin(&self, x: f64) -> f64 {
        let normalized = x * self.cached_constants.inv_two_pi;
        let normalized = normalized - normalized.floor();
        let index = normalized * self.cached_constants.table_size_f64;
        
        let i = index as usize;
        let frac = index - (i as f64);
        
        let i1 = i & self.cached_constants.table_size_mask;
        let i2 = (i + 1) & self.cached_constants.table_size_mask;
        
        unsafe {
            let val1 = *self.sin_table.get_unchecked(i1);
            let val2 = *self.sin_table.get_unchecked(i2);
            val1 + frac * (val2 - val1)
        }
    }
    
    #[inline(always)]
    fn ultra_fast_cos(&self, x: f64) -> f64 {
        let normalized = x * self.cached_constants.inv_two_pi;
        let normalized = normalized - normalized.floor();
        let index = normalized * self.cached_constants.table_size_f64;
        
        let i = index as usize;
        let frac = index - (i as f64);
        
        let i1 = i & self.cached_constants.table_size_mask;
        let i2 = (i + 1) & self.cached_constants.table_size_mask;
        
        unsafe {
            let val1 = *self.cos_table.get_unchecked(i1);
            let val2 = *self.cos_table.get_unchecked(i2);
            val1 + frac * (val2 - val1)
        }
    }

    #[wasm_bindgen]
    pub fn generate_gradient_data(&mut self, width: u32, height: u32) -> Vec<u8> {
        let capacity = (width * height * 4) as usize;
        let mut data = vec![0u8; capacity];
        
        if width * height > 1024 * 1024 {
            self.generate_gradient_parallel(&mut data, width, height)
        } else {
            self.generate_gradient_simd(&mut data, width, height)
        }
        
        data
    }

    fn generate_gradient_parallel(&self, data: &mut [u8], width: u32, height: u32) {
        let width_f = width as f64;
        let height_f = height as f64;
        let inv_width = 1.0 / width_f;
        let inv_height = 1.0 / height_f;
        
        let seed_f = self.params.seed as f64;
        let angle_rad = self.params.gradient_angle * self.cached_constants.pi_over_180;
        let cos_angle = angle_rad.cos();
        let sin_angle = angle_rad.sin();
        
        let organic_mult = self.params.organic_distortion;
        let flow_mult = self.params.flow_intensity * 0.5;
        let variance_mult = self.params.color_variance;
        let zoom_factor = 1.0 / self.params.zoom.max(0.1);
        let offset_x_scaled = self.params.offset_x * 0.001;
        let offset_y_scaled = self.params.offset_y * 0.001;
        
        let rotation_rad = self.params.canvas_rotation * self.cached_constants.pi_over_180;
        let cos_rotation = rotation_rad.cos();
        let sin_rotation = rotation_rad.sin();
        data.par_chunks_mut(width as usize * 4)
            .enumerate()
            .for_each(|(y, row_data)| {
                let ny = (y as f64 * inv_height) * 2.0 - 1.0;
                
                for (x_chunk, pixel_chunk) in row_data.chunks_mut(16).enumerate() {
                    let base_x = x_chunk * 4;
                    
                    for (local_x, pixel) in pixel_chunk.chunks_mut(4).enumerate() {
                        let x = base_x + local_x;
                        if x >= width as usize { break; }
                        
                        let nx = (x as f64 * inv_width) * 2.0 - 1.0;
                        
                        let rotated_nx = nx * cos_rotation - ny * sin_rotation;
                        let rotated_ny = nx * sin_rotation + ny * cos_rotation;
                        
                        let rotated_x = (rotated_nx * zoom_factor) + offset_x_scaled;
                        let rotated_y = (rotated_ny * zoom_factor) + offset_y_scaled;
                        
                        let color = self.compute_ultra_optimized_gradient(
                            rotated_x, rotated_y, cos_angle, sin_angle, 
                            seed_f, organic_mult, flow_mult, variance_mult
                        );
                        
                        pixel[0] = (color[0] * 255.0).clamp(0.0, 255.0) as u8;
                        pixel[1] = (color[1] * 255.0).clamp(0.0, 255.0) as u8;
                        pixel[2] = (color[2] * 255.0).clamp(0.0, 255.0) as u8;
                        pixel[3] = 255;
                    }
                }
            });
    }

    fn generate_gradient_simd(&self, data: &mut [u8], width: u32, height: u32) {
        let width_f = width as f64;
        let height_f = height as f64;
        let inv_width = 1.0 / width_f;
        let inv_height = 1.0 / height_f;
        
        let seed_f = self.params.seed as f64;
        let angle_rad = self.params.gradient_angle * self.cached_constants.pi_over_180;
        let cos_angle = angle_rad.cos();
        let sin_angle = angle_rad.sin();
        
        let organic_mult = self.params.organic_distortion;
        let flow_mult = self.params.flow_intensity * 0.5;
        let variance_mult = self.params.color_variance;
        let zoom_factor = 1.0 / self.params.zoom.max(0.1);
        let offset_x_scaled = self.params.offset_x * 0.001;
        let offset_y_scaled = self.params.offset_y * 0.001;
        
        let rotation_rad = self.params.canvas_rotation * self.cached_constants.pi_over_180;
        let cos_rotation = rotation_rad.cos();
        let sin_rotation = rotation_rad.sin();
        
        let mut idx = 0;
        for y in 0..height {
            let ny = (y as f64 * inv_height) * 2.0 - 1.0;
            
            let mut x = 0;
            while x + 4 <= width {
                let nx1 = (x as f64 * inv_width) * 2.0 - 1.0;
                let nx2 = ((x + 1) as f64 * inv_width) * 2.0 - 1.0;
                let nx3 = ((x + 2) as f64 * inv_width) * 2.0 - 1.0;
                let nx4 = ((x + 3) as f64 * inv_width) * 2.0 - 1.0;
                
                // Apply rotation to normalized coordinates first
                let rotated_nx1 = nx1 * cos_rotation - ny * sin_rotation;
                let rotated_ny1 = nx1 * sin_rotation + ny * cos_rotation;
                let rotated_nx2 = nx2 * cos_rotation - ny * sin_rotation;
                let rotated_ny2 = nx2 * sin_rotation + ny * cos_rotation;
                let rotated_nx3 = nx3 * cos_rotation - ny * sin_rotation;
                let rotated_ny3 = nx3 * sin_rotation + ny * cos_rotation;
                let rotated_nx4 = nx4 * cos_rotation - ny * sin_rotation;
                let rotated_ny4 = nx4 * sin_rotation + ny * cos_rotation;
                
                // Then apply zoom and offset
                let tx1 = (rotated_nx1 * zoom_factor) + offset_x_scaled;
                let ty1 = (rotated_ny1 * zoom_factor) + offset_y_scaled;
                let tx2 = (rotated_nx2 * zoom_factor) + offset_x_scaled;
                let ty2 = (rotated_ny2 * zoom_factor) + offset_y_scaled;
                let tx3 = (rotated_nx3 * zoom_factor) + offset_x_scaled;
                let ty3 = (rotated_ny3 * zoom_factor) + offset_y_scaled;
                let tx4 = (rotated_nx4 * zoom_factor) + offset_x_scaled;
                let ty4 = (rotated_ny4 * zoom_factor) + offset_y_scaled;
                
                for i in 0..4 {
                    let (rotated_x, rotated_y) = match i {
                        0 => (tx1, ty1),
                        1 => (tx2, ty2),
                        2 => (tx3, ty3),
                        _ => (tx4, ty4)
                    };
                    
                    let color = self.compute_ultra_optimized_gradient(
                        rotated_x, rotated_y, cos_angle, sin_angle,
                        seed_f, organic_mult, flow_mult, variance_mult
                    );
                    
                    data[idx] = (color[0] * 255.0).clamp(0.0, 255.0) as u8;
                    data[idx + 1] = (color[1] * 255.0).clamp(0.0, 255.0) as u8;
                    data[idx + 2] = (color[2] * 255.0).clamp(0.0, 255.0) as u8;
                    data[idx + 3] = 255;
                    idx += 4;
                }
                
                x += 4;
            }
            
            while x < width {
                let nx = (x as f64 * inv_width) * 2.0 - 1.0;
                
                // Apply rotation to normalized coordinates first
                let rotated_nx = nx * cos_rotation - ny * sin_rotation;
                let rotated_ny = nx * sin_rotation + ny * cos_rotation;
                
                // Then apply zoom and offset
                let rotated_x = (rotated_nx * zoom_factor) + offset_x_scaled;
                let rotated_y = (rotated_ny * zoom_factor) + offset_y_scaled;
                
                let color = self.compute_ultra_optimized_gradient(
                    rotated_x, rotated_y, cos_angle, sin_angle,
                    seed_f, organic_mult, flow_mult, variance_mult
                );
                
                data[idx] = (color[0] * 255.0).clamp(0.0, 255.0) as u8;
                data[idx + 1] = (color[1] * 255.0).clamp(0.0, 255.0) as u8;
                data[idx + 2] = (color[2] * 255.0).clamp(0.0, 255.0) as u8;
                data[idx + 3] = 255;
                idx += 4;
                x += 1;
            }
        }
    }

    #[inline(always)]
    fn compute_ultra_optimized_gradient(&self, x: f64, y: f64, cos_angle: f64, sin_angle: f64, seed: f64, organic_mult: f64, flow_mult: f64, variance_mult: f64) -> [f64; 3] {
        // Use pre-calculated multipliers from cached constants
        let multipliers = &self.cached_constants.organic_multipliers;
        let flow_mults = &self.cached_constants.flow_multipliers;
        
        // Pre-calculate seed offsets (vectorizable)
        let seed_01 = seed * flow_mults[2]; // 0.1
        let seed_02 = seed * flow_mults[3]; // 0.2
        let seed_03 = seed * 0.3;
        let seed_04 = seed * 0.4;
        let seed_05 = seed * 0.5;
        let seed_06 = seed * 0.6;
        let seed_07 = seed * 0.7;
        let seed_08 = seed * 0.8;
        
        // Use cached multipliers for better performance
        let x3 = x * multipliers[0];    // 3.0
        let y25 = y * multipliers[1];   // 2.5
        let x18 = x * multipliers[2];   // 1.8
        let y42 = y * multipliers[3];   // 4.2
        let x51 = x * multipliers[4];   // 5.1
        let y13 = y * multipliers[5];   // 1.3
        
        // Optimized distortion calculation with reduced function calls
        let distortion1 = self.ultra_fast_sin(x3 + seed_01) * self.ultra_fast_cos(y25 + seed_02);
        let distortion2 = self.ultra_fast_cos(x18 + seed_03) * self.ultra_fast_sin(y42 + seed_04);
        let distortion3 = self.ultra_fast_sin(x51 + seed_05) * self.ultra_fast_cos(y13 + seed_06);
        
        // Fused multiply-add for better performance
        let organic_offset = (distortion1 * 0.5 + distortion2 * 0.3 + distortion3 * 0.2) * organic_mult;
        
        // Use cached flow multipliers
        let x2 = x * flow_mults[0];     // 2.0
        let y2 = y * flow_mults[1];     // 2.0
        let flow_x = self.ultra_fast_sin(x2 + seed_07) * flow_mult;
        let flow_y = self.ultra_fast_cos(y2 + seed_08) * flow_mult;
        
        let final_x = x + organic_offset + flow_x;
        let final_y = y + organic_offset + flow_y;
        
        let gradient_pos = match self.blend_mode_cached {
            BlendMode::Radial => {
                let center_x = (self.params.center_bias - 0.5) * 1.5;
                let center_y = (self.params.center_bias - 0.5) * 1.5;
                let dx = final_x - center_x;
                let dy = final_y - center_y;
                (dx * dx + dy * dy).sqrt()
            },
            BlendMode::Angular => {
                let offset_angle = self.params.center_bias * self.cached_constants.two_pi;
                let angle = final_y.atan2(final_x) + offset_angle;
                ((angle + PI) / self.cached_constants.two_pi) % 1.0
            },
            BlendMode::Diamond => {
                let center_x = (self.params.center_bias - 0.5) * 1.2;
                let center_y = (self.params.center_bias - 0.5) * 1.2;
                ((final_x - center_x).abs() + (final_y - center_y).abs()) * 0.7
            },
            BlendMode::Vortex => {
                let center_x = (self.params.center_bias - 0.5) * 2.0;
                let center_y = (self.params.center_bias - 0.5) * 2.0;
                let dx = final_x - center_x;
                let dy = final_y - center_y;
                let radius = (dx * dx + dy * dy).sqrt();
                let angle = dy.atan2(dx);
                let spiral = angle + radius * 3.0 + seed * 0.1;
                let vortex_strength = (-radius * 2.0).exp();
                let pattern = self.ultra_fast_sin(spiral * 2.0) * vortex_strength + radius * 0.3;
                (pattern + 1.0) * 0.5
            },
            BlendMode::Smooth => {
                let rotated_x = final_x * cos_angle + final_y * sin_angle;
                let offset = (self.params.center_bias - 0.5) * 2.0;
                (rotated_x + offset + 1.0) * 0.5
            }
        };
        
        let adjusted_pos = gradient_pos * self.params.color_spread;
        // Use cached multipliers for variance calculation
        let variance = self.ultra_fast_sin(final_x * multipliers[6] + final_y * multipliers[7] + seed) * variance_mult;
        let final_pos = adjusted_pos + variance;
        
        self.interpolate_colors_ultra_optimized(final_pos)
    }

    #[inline(always)]
    fn interpolate_colors_ultra_optimized(&self, t: f64) -> [f64; 3] {
        let normalized_t = ((t % 2.0) + 2.0) % 2.0;
        let wrapped_t = if normalized_t > 1.0 { 2.0 - normalized_t } else { normalized_t };
        
        let scaled_t = wrapped_t * 3.0;
        let segment_index = scaled_t.floor() as usize;
        let local_t = scaled_t - segment_index as f64;
        
        let (color1, color2) = unsafe {
            let idx1 = segment_index.min(3);
            let idx2 = (segment_index + 1).min(3);
            (
                *self.color_cache.get_unchecked(idx1),
                *self.color_cache.get_unchecked(idx2)
            )
        };
        
        let t_squared = local_t * local_t;
        let smooth_t = t_squared * (3.0 - 2.0 * local_t);
        let inv_smooth_t = 1.0 - smooth_t;
        
        [
            color1[0] * inv_smooth_t + color2[0] * smooth_t,
            color1[1] * inv_smooth_t + color2[1] * smooth_t,
            color1[2] * inv_smooth_t + color2[2] * smooth_t,
        ]
    }

    #[wasm_bindgen]
    pub fn apply_color_preset(&mut self, preset_name: &str) {
        let colors = match preset_name {
            "sunset" => [
                [1.0, 0.6, 0.2],   // Warm orange
                [1.0, 0.3, 0.4],   // Pink-red
                [0.4, 0.2, 0.6],   // Purple
                [0.1, 0.1, 0.2],   // Dark blue
            ],
            "ocean" => [
                [0.0, 0.3, 0.5],   // Deep blue
                [0.0, 0.5, 0.7],   // Ocean blue
                [0.2, 0.7, 0.9],   // Light blue
                [0.8, 0.9, 1.0],   // Almost white
            ],
            "forest" => [
                [0.2, 0.6, 0.3],   // Forest green
                [0.6, 0.8, 0.4],   // Light green
                [0.9, 0.9, 0.8],   // Cream
                [0.3, 0.3, 0.2],   // Dark brown
            ],
            "cosmic" => [
                [0.8, 0.2, 0.9],   // Bright purple
                [0.2, 0.8, 0.9],   // Cyan
                [0.9, 0.7, 0.2],   // Gold
                [0.1, 0.1, 0.1],   // Black
            ],
            "fire" => [
                [1.0, 0.9, 0.2],   // Bright yellow
                [1.0, 0.5, 0.0],   // Orange
                [0.8, 0.1, 0.0],   // Red
                [0.2, 0.0, 0.0],   // Dark red
            ],
            "ice" => [
                [0.9, 0.95, 1.0],  // Ice white
                [0.7, 0.85, 0.95], // Light blue
                [0.4, 0.6, 0.8],   // Medium blue
                [0.1, 0.2, 0.4],   // Dark blue
            ],
            "earth" => [
                [0.8, 0.7, 0.5],   // Sand
                [0.6, 0.4, 0.2],   // Brown
                [0.4, 0.3, 0.1],   // Dark brown
                [0.2, 0.15, 0.05], // Very dark brown
            ],
            "neon" => [
                [1.0, 0.0, 1.0],   // Magenta
                [0.0, 1.0, 1.0],   // Cyan
                [1.0, 1.0, 0.0],   // Yellow
                [1.0, 0.0, 0.0],   // Red
            ],
            _ => return,
        };
        
        self.params.color_1 = colors[0];
        self.params.color_2 = colors[1];
        self.params.color_3 = colors[2];
        self.params.color_4 = colors[3];
        
        self.color_cache = colors;
    }

    #[wasm_bindgen]
    pub fn randomize_colors(&mut self, seed: u32) {
        let mut rng_state = seed as f64;
        
        let mut next_random = || {
            rng_state = (rng_state * 9301.0 + 49297.0) % 233280.0;
            rng_state / 233280.0
        };
        
        for i in 0..4 {
            let hue = next_random() * 360.0;
            let saturation = 0.6 + next_random() * 0.4;
            let lightness = if i % 2 == 0 { 0.3 + next_random() * 0.4 } else { 0.6 + next_random() * 0.4 };
            
            let color = self.hsl_to_rgb(hue, saturation, lightness);
            match i {
                0 => {
                    self.params.color_1 = color;
                    self.color_cache[0] = color;
                }
                1 => {
                    self.params.color_2 = color;
                    self.color_cache[1] = color;
                }
                2 => {
                    self.params.color_3 = color;
                    self.color_cache[2] = color;
                }
                3 => {
                    self.params.color_4 = color;
                    self.color_cache[3] = color;
                }
                _ => {}
            }
        }
    }

    fn hsl_to_rgb(&self, h: f64, s: f64, l: f64) -> [f64; 3] {
        let h = h / 360.0;
        let c = (1.0 - (2.0 * l - 1.0).abs()) * s;
        let x = c * (1.0 - ((h * 6.0) % 2.0 - 1.0).abs());
        let m = l - c / 2.0;
        
        let (r, g, b) = if h < 1.0/6.0 {
            (c, x, 0.0)
        } else if h < 2.0/6.0 {
            (x, c, 0.0)
        } else if h < 3.0/6.0 {
            (0.0, c, x)
        } else if h < 4.0/6.0 {
            (0.0, x, c)
        } else if h < 5.0/6.0 {
            (x, 0.0, c)
        } else {
            (c, 0.0, x)
        };
        
        [r + m, g + m, b + m]
    }


    #[wasm_bindgen]
    pub fn get_params_json(&self) -> String {
        serde_json::to_string(&self.params).unwrap_or_else(|_| "{}".to_string())
    }
    
    
    #[wasm_bindgen]
    pub fn randomize_with_advanced_rng(&mut self, seed: u32, creativity_level: f64) {
        let mut rng = Xoshiro256PlusPlus::seed_from_u64(seed as u64);
        
        let creativity = creativity_level.clamp(0.0, 1.0);
        
        self.params.flow_intensity = rng.gen::<f64>() * creativity;
        self.params.organic_distortion = rng.gen::<f64>() * creativity;
        self.params.color_variance = rng.gen::<f64>() * creativity * 0.3;
        self.params.color_spread = 0.5 + rng.gen::<f64>() * creativity;
        
        for i in 0..4 {
            let hue = rng.gen::<f64>() * 360.0;
            let saturation = 0.4 + rng.gen::<f64>() * 0.6 * creativity;
            let lightness = if i % 2 == 0 { 
                0.2 + rng.gen::<f64>() * 0.5 
            } else { 
                0.5 + rng.gen::<f64>() * 0.5 
            };
            
            let color = self.hsl_to_rgb(hue, saturation, lightness);
            match i {
                0 => { self.params.color_1 = color; self.color_cache[0] = color; }
                1 => { self.params.color_2 = color; self.color_cache[1] = color; }
                2 => { self.params.color_3 = color; self.color_cache[2] = color; }
                3 => { self.params.color_4 = color; self.color_cache[3] = color; }
                _ => {}
            }
        }
        
        let blend_modes = ["smooth", "radial", "angular", "diamond", "vortex"];
        let mode_index = (rng.gen::<f64>() * blend_modes.len() as f64) as usize;
        self.params.blend_mode = blend_modes[mode_index].to_string();
        self.blend_mode_cached = BlendMode::from_string(&self.params.blend_mode);
    }
}

#[wasm_bindgen(start)]
pub fn main() {
    std::panic::set_hook(Box::new(console_error_panic_hook::hook));
}