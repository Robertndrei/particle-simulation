/**
 * WebGPU detection and capability checking
 */

export interface WebGPUCapabilities {
  supported: boolean;
  adapter: GPUAdapter | null;
  device: GPUDevice | null;
  maxWorkgroupSize: number;
  maxStorageBufferSize: number;
  maxComputeInvocationsPerWorkgroup: number;
}

/**
 * Detects WebGPU support and initializes device
 */
export async function detectWebGPU(): Promise<WebGPUCapabilities> {
  const result: WebGPUCapabilities = {
    supported: false,
    adapter: null,
    device: null,
    maxWorkgroupSize: 0,
    maxStorageBufferSize: 0,
    maxComputeInvocationsPerWorkgroup: 0
  };

  // Check if WebGPU is available
  if (!navigator.gpu) {
    console.warn('WebGPU not supported in this browser');
    return result;
  }

  try {
    // Request adapter
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: 'high-performance'
    });

    if (!adapter) {
      console.warn('No WebGPU adapter found');
      return result;
    }

    // Request device
    const device = await adapter.requestDevice({
      requiredLimits: {
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        maxComputeWorkgroupSizeX: adapter.limits.maxComputeWorkgroupSizeX,
        maxComputeInvocationsPerWorkgroup: adapter.limits.maxComputeInvocationsPerWorkgroup
      }
    });

    // Handle device loss
    device.lost.then((info) => {
      console.error('WebGPU device lost:', info.message);
      if (info.reason !== 'destroyed') {
        // Could attempt to recreate device here
      }
    });

    result.supported = true;
    result.adapter = adapter;
    result.device = device;
    result.maxWorkgroupSize = device.limits.maxComputeWorkgroupSizeX;
    result.maxStorageBufferSize = device.limits.maxStorageBufferBindingSize;
    result.maxComputeInvocationsPerWorkgroup = device.limits.maxComputeInvocationsPerWorkgroup;

    console.log('WebGPU initialized successfully');
    console.log(`  Max workgroup size: ${result.maxWorkgroupSize}`);
    console.log(`  Max storage buffer: ${(result.maxStorageBufferSize / 1024 / 1024).toFixed(1)} MB`);

    return result;
  } catch (error) {
    console.warn('Failed to initialize WebGPU:', error);
    return result;
  }
}

/**
 * Check if we can run a given number of particles
 */
export function canRunParticleCount(capabilities: WebGPUCapabilities, particleCount: number): boolean {
  if (!capabilities.supported) return false;

  // Each particle needs: x, y, vx, vy, type = 5 floats = 20 bytes
  const bytesNeeded = particleCount * 5 * 4 * 2; // *2 for double buffer
  return bytesNeeded < capabilities.maxStorageBufferSize;
}
