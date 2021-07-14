class AudioProcessor extends AudioWorkletProcessor {
	constructor() {
		super();
	}

	process(inputList, outputList, parameters) {
		const sourceLimit = Math.min(inputList.length, outputList.length);

		for (let inputNum = 0; inputNum < sourceLimit; inputNum++) {
			let input = inputList[inputNum];
			let output = outputList[inputNum];
			let channelCount = Math.min(input.length, output.length);

			for (let channel = 0; channel < channelCount; channel++) {
				let sampleCount = input[channel].length;
				for (let i = 0; i < sampleCount; i++) {
					let sample = input[channel][i];
					output[channel][i] = sample;
				}
			}
		}

		this.port.postMessage('data updated');
		return true;
	}
};

registerProcessor('audio-processor', AudioProcessor);