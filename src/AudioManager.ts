export class AudioManager {
  private audioContext: AudioContext;
  private segments: AudioSegment[] = [];
  private currentSegmentIndex: number = 0;
  private isProcessing: boolean = false;
  private currentSource: AudioBufferSourceNode | null = null;
  private isPlaying: boolean = false;
  private segmentDuration: number = 0.3;
  private lastPlayStartTime: number = 0;
  private gainNode: GainNode;
  private destinationNode: MediaStreamAudioDestinationNode | null = null;

  constructor(destinationNode?: MediaStreamAudioDestinationNode) {
    // Use the provided audio context from the destination node if available
    this.audioContext = destinationNode?.context || new (window.AudioContext || window.webkitAudioContext)();
    this.gainNode = this.audioContext.createGain();
    this.destinationNode = destinationNode || null;
    
    // Connect to both the default destination and the recording destination if provided
    this.gainNode.connect(this.audioContext.destination);
    if (this.destinationNode) {
      this.gainNode.connect(this.destinationNode);
    }
  }

  private isValidAudioFormat(file: File): boolean {
    const validTypes = ['audio/mp3', 'audio/mpeg', 'audio/wav', 'audio/ogg'];
    return validTypes.includes(file.type);
  }

  private async splitAudioIntoSegments(audioBuffer: AudioBuffer): Promise<AudioSegment[]> {
    const sampleRate = audioBuffer.sampleRate;
    const samplesPerSegment = this.segmentDuration * sampleRate;
    const segments: AudioSegment[] = [];

    for (let i = 0; i < audioBuffer.length; i += samplesPerSegment) {
      const segmentLength = Math.min(samplesPerSegment, audioBuffer.length - i);
      const segmentBuffer = this.audioContext.createBuffer(
        audioBuffer.numberOfChannels,
        segmentLength,
        sampleRate
      );

      for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
        const channelData = audioBuffer.getChannelData(channel);
        const segmentData = segmentBuffer.getChannelData(channel);
        segmentData.set(channelData.slice(i, i + segmentLength));
      }

      segments.push({
        buffer: segmentBuffer,
        startTime: i / sampleRate,
        duration: this.segmentDuration
      });
    }

    return segments;
  }

  public async processAudioFile(file: File): Promise<void> {
    if (!this.isValidAudioFormat(file)) {
      throw new Error('Invalid audio format. Please upload MP3, WAV, or OGG files.');
    }

    try {
      this.isProcessing = true;
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
      
      this.clearSegments();
      
      const newSegments = await this.splitAudioIntoSegments(audioBuffer);
      this.segments.push(...newSegments);
      this.isProcessing = false;

      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
    } catch (error) {
      this.isProcessing = false;
      throw new Error(`Failed to process audio file: ${error.message}`);
    }
  }

  public async playNextSegment(): Promise<void> {
    if (this.segments.length === 0 || this.isProcessing) return;

    const currentTime = this.audioContext.currentTime;
    const timeSinceLastPlay = currentTime - this.lastPlayStartTime;

    if (timeSinceLastPlay < this.segmentDuration * 0.9) {
      return;
    }

    try {
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      if (this.currentSource) {
        try {
          this.currentSource.stop();
        } catch (e) {
          // Ignore errors if source is already stopped
        }
      }

      const segment = this.segments[this.currentSegmentIndex];
      const source = this.audioContext.createBufferSource();
      
      source.buffer = segment.buffer;
      source.connect(this.gainNode);

      source.start(0);
      this.lastPlayStartTime = currentTime;
      this.currentSource = source;
      this.isPlaying = true;

      source.onended = () => {
        this.isPlaying = false;
        this.currentSegmentIndex = (this.currentSegmentIndex + 1) % this.segments.length;
      };
    } catch (error) {
      console.error('Playback error:', error);
      this.isPlaying = false;
    }
  }

  public clearSegments(): void {
    if (this.currentSource) {
      try {
        this.currentSource.stop();
      } catch (e) {
        // Ignore errors if source is already stopped
      }
      this.currentSource = null;
    }
    
    this.segments = [];
    this.currentSegmentIndex = 0;
    this.isPlaying = false;
    this.lastPlayStartTime = 0;
  }

  public reset(): void {
    this.currentSegmentIndex = 0;
    this.isPlaying = false;
    this.lastPlayStartTime = 0;
    
    if (this.currentSource) {
      try {
        this.currentSource.stop();
      } catch (e) {
        // Ignore errors if source is already stopped
      }
      this.currentSource = null;
    }
  }

  public getSegmentsCount(): number {
    return this.segments.length;
  }

  public isProcessingAudio(): boolean {
    return this.isProcessing;
  }

  public getAudioStream(): MediaStream | null {
    return this.destinationNode?.stream || null;
  }
}
