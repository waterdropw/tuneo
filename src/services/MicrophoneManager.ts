import MicrophoneStreamModule, { AudioBuffer, MicrophoneStreamModuleEvents } from "@/../modules/microphone-stream";

// Define event types for microphone state changes
export type MicrophoneEventType = 
  | "onAudioBuffer" 
  | "onRecordingStart" 
  | "onRecordingStop" 
  | "onRecordingPause" 
  | "onRecordingResume" 
  | "onError";

// Define callback function types
export type MicrophoneEventCallback = (
  data: AudioBuffer | string | undefined, 
  error?: Error
) => void;

// Define microphone state
export type MicrophoneState = "idle" | "recording" | "paused";

export class MicrophoneManager {
  // Singleton instance
  private static instance: MicrophoneManager | null = null;
  
  // Private constructor to prevent direct instantiation
  private constructor() {
    this.initialize();
  }
  
  // Event listeners map
  private eventListeners: Map<MicrophoneEventType, Set<MicrophoneEventCallback>> = new Map();
  
  // Microphone state
  private state: MicrophoneState = "idle";
  
  // Error tracking
  private lastError: Error | null = null;
  
  // Initialize the manager
  private initialize(): void {
    // Set up native event listeners
    this.setupNativeEventListeners();
  }
  
  // Set up native module event listeners
  private setupNativeEventListeners(): void {
    // Note: In React Native, native module events are typically handled via EventEmitter
    // but the current module doesn't expose an EventEmitter interface directly
    // We'll assume the app will forward events to this manager
  }
  
  // Static method to get the singleton instance
  public static getInstance(): MicrophoneManager {
    if (!MicrophoneManager.instance) {
      try {
        MicrophoneManager.instance = new MicrophoneManager();
      } catch (error) {
        console.error("Failed to create MicrophoneManager instance:", error);
        throw error;
      }
    }
    return MicrophoneManager.instance;
  }
  
  // Prevent cloning (override Object.clone method)
  public clone(): never {
    throw new Error("Cloning of MicrophoneManager is not allowed.");
  }
  
  // Prevent deserialization (for environments that support it)
  private readResolve(): MicrophoneManager {
    return MicrophoneManager.getInstance();
  }
  
  // Start recording
  public async startRecording(): Promise<void> {
    try {
      if (this.state === "recording") {
        return;
      }
      
      MicrophoneStreamModule.startRecording();
      this.state = "recording";
      this.emitEvent("onRecordingStart");
      this.lastError = null;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.handleError(err, "Failed to start recording");
      throw err;
    }
  }
  
  // Stop recording
  public async stopRecording(): Promise<void> {
    try {
      if (this.state === "idle") {
        return;
      }
      
      MicrophoneStreamModule.stopRecording();
      this.state = "idle";
      this.emitEvent("onRecordingStop");
      this.lastError = null;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.handleError(err, "Failed to stop recording");
      throw err;
    }
  }
  
  // Pause recording (emulated if native module doesn't support it)
  public async pauseRecording(): Promise<void> {
    try {
      if (this.state !== "recording") {
        return;
      }
      
      // Note: Native module doesn't support pause, so we'll just update state
      // In a real implementation, this would call the native module's pause method
      this.state = "paused";
      this.emitEvent("onRecordingPause");
      this.lastError = null;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.handleError(err, "Failed to pause recording");
      throw err;
    }
  }
  
  // Resume recording (emulated if native module doesn't support it)
  public async resumeRecording(): Promise<void> {
    try {
      if (this.state !== "paused") {
        return;
      }
      
      // Note: Native module doesn't support resume, so we'll just update state
      // In a real implementation, this would call the native module's resume method
      this.state = "recording";
      this.emitEvent("onRecordingResume");
      this.lastError = null;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.handleError(err, "Failed to resume recording");
      throw err;
    }
  }
  
  // Get sample rate
  public getSampleRate(): number {
    try {
      return MicrophoneStreamModule.getSampleRate();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.handleError(err, "Failed to get sample rate");
      return 0;
    }
  }
  
  // Get buffers per second
  public getBuffersPerSecond(): number {
    try {
      return MicrophoneStreamModule.BUF_PER_SEC;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.handleError(err, "Failed to get buffers per second");
      return 0;
    }
  }
  
  // Get current state
  public getState(): MicrophoneState {
    return this.state;
  }
  
  // Get last error
  public getLastError(): Error | null {
    return this.lastError;
  }
  
  // Add event listener
  public addEventListener(
    eventType: MicrophoneEventType,
    callback: MicrophoneEventCallback
  ): void {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, new Set());
    }
    this.eventListeners.get(eventType)!.add(callback);
  }
  
  // Remove event listener
  public removeEventListener(
    eventType: MicrophoneEventType,
    callback: MicrophoneEventCallback
  ): void {
    if (this.eventListeners.has(eventType)) {
      this.eventListeners.get(eventType)!.delete(callback);
      // Clean up empty sets
      if (this.eventListeners.get(eventType)!.size === 0) {
        this.eventListeners.delete(eventType);
      }
    }
  }
  
  // Remove all event listeners for a specific event type
  public removeAllListeners(eventType?: MicrophoneEventType): void {
    if (eventType) {
      this.eventListeners.delete(eventType);
    } else {
      this.eventListeners.clear();
    }
  }
  
  // Emit event to listeners
  public emitEvent(
    eventType: MicrophoneEventType,
    data?: AudioBuffer | string,
    error?: Error
  ): void {
    if (this.eventListeners.has(eventType)) {
      const listeners = this.eventListeners.get(eventType)!;
      // Create a copy to avoid issues if listeners are removed during iteration
      const listenersCopy = new Set(listeners);
      listenersCopy.forEach(callback => {
        try {
          callback(data as any, error);
        } catch (callbackError) {
          console.error(`Error in ${eventType} listener:`, callbackError);
        }
      });
    }
  }
  
  // Handle audio buffer (to be called from the app when onAudioBuffer is received)
  public handleAudioBuffer(buffer: AudioBuffer): void {
    if (this.state === "recording") {
      this.emitEvent("onAudioBuffer", buffer);
    }
  }
  
  // Error handling
  private handleError(error: Error, context: string): void {
    this.lastError = error;
    console.error(`${context}:`, error);
    this.emitEvent("onError", undefined, error);
    
    // If there's a critical error, stop recording to prevent resource leaks
    if (this.state !== "idle") {
      try {
        MicrophoneStreamModule.stopRecording();
        this.state = "idle";
        this.emitEvent("onRecordingStop");
      } catch (stopError) {
        console.error("Failed to stop recording after error:", stopError);
      }
    }
  }
  
  // Cleanup resources
  public cleanup(): void {
    this.removeAllListeners();
    if (this.state !== "idle") {
      try {
        MicrophoneStreamModule.stopRecording();
      } catch (error) {
        console.error("Error during cleanup:", error);
      }
      this.state = "idle";
    }
  }
  
  // Prevent extension
  // In TypeScript, we can use 'sealed' or 'final' equivalents through design
  
  // Override Object.defineProperty to prevent adding new properties
  public defineProperty(): never {
    throw new Error("Adding properties to MicrophoneManager is not allowed.");
  }
  
  // Override Object.preventExtensions to make the instance non-extensible
  public preventExtensions(): never {
    throw new Error("MicrophoneManager is already non-extensible.");
  }
}

// Make the class non-extensible
Object.preventExtensions(MicrophoneManager.prototype);

// Ensure the singleton instance is created only once
Object.freeze(MicrophoneManager);
