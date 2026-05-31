class PCMProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel?.length > 0) {
      this.port.postMessage(channel.slice());
    }
    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
