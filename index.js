//
const audioWindow = 0.5;  //how long the audio data to be considered
const energyThreshold = 0.04;  //below this volume = silence
const energyRateThreshold = 0.1;  //percentage of noise beyond volume threshold allowed
const normalizeStrength = 0.5;  //normalize audio data to a more understandable level

const fftSize = 512;
const bufferLength = 512;

window.AudioContext = window.AudioContext || window.webkitAudioContext;
let audioContext;
let recorderRTC;
let mediaStream;
let audioStream;
let analyser;
let scriptProcessorNode;

let timeDomainDataByte;
let timeDomainDataFloat;
let frequencyDomainDataByte;
let frequencyDomainDataFloat;

navigator.mediaDevices.getUserMedia({
	video: false,
	audio: true,
}).then((stream) => {
	mediaStream = stream;


	/*
	recorderRTC = new RecordRTC(stream, {
		type: 'audio',
		recorderType: StereoAudioRecorder,
		timeSlice: audioWindow * 1000,
		desiredSampRate: 44000,
		bufferSize: 2048,
		numberOfAudioChannels: 1,
		ondataavailable: function (blob) {
			blob.arrayBuffer().then((arrayBuffer) => {
				audioContext.decodeAudioData(arrayBuffer).then((audioBuffer) => {
					let sampledData = sampleData(audioBuffer);
					visualizeData(sampledData);
				});
			});
		},
	});
	 */
});

/**********************
 * Events - Button
 * ********************
 */
function onClickStart() {
	init();
	/*
	recorderRTC.startRecording();
	speechStarted = false;
	*/
}

function onClickStop() {
	if (audioContext && audioContext.state === 'running') {
		audioContext.close();
	}
	/*
	recorderRTC.stopRecording((blobURL) => {
		//let blob = recorder.getBlob();
		let url = blobURL;
		playback(url);
		recorderRTC.reset();
	});
	*/
}

/**************
 * Helper
 * ************/
const volumeText = document.getElementById('volume');
const energyText = document.getElementById('energy');
const signalText = document.getElementById('signal');
const trendText = document.getElementById('trend');
const startText = document.getElementById('start_time');
const currentText = document.getElementById('current_time');
const diffText = document.getElementById('time_diff');

let speechStarted = false;
let trendArray = new Array(500);
function init() {
	start = false;
	end = false;
	audioContext = new AudioContext();
	audioStream = audioContext.createMediaStreamSource(mediaStream);

	//analyser
	// https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/createAnalyser
	analyser = audioContext.createAnalyser();
	analyser.smoothingTimeConstant = 0.85; //0.99
	analyser.fftSize = fftSize;
	timeDomainDataByte = new Uint8Array(analyser.frequencyBinCount);
	timeDomainDataFloat = new Float32Array(analyser.frequencyBinCount);
	frequencyDomainDataByte = new Uint8Array(analyser.frequencyBinCount);
	frequencyDomainDataFloat = new Float32Array(analyser.frequencyBinCount);

	let energy_offset =  1e-8;
	let energy_threshold_ratio_pos = 5;
	let energy_threshold_ratio_neg = 0.9;
	let energy_threshold_pos = energy_offset * energy_threshold_ratio_pos;
	let energy_threshold_neg = energy_offset * energy_threshold_ratio_neg;
	let voiceTrend = 0;
	let voiceTrendMax = 10;
	let voiceTrendMin = -10;
	let voiceTrendStart = 5;
	let voiceTrendEnd = -5;
	let filter = []; // - accept human voice frequency range only
	let hertzPerBin = audioContext.sampleRate / fftSize;
	let hertz = 0.0;
	for (let i = 0; i < analyser.frequencyBinCount; i++) {
		filter[i] = 0;
		hertz = i * hertzPerBin;
		if(20 <= hertz && hertz<=20000)
			filter[i] = 1;
		else
			filter[i] = 0;
	}

	let energy_integration = 1;
	let iterationFrequency = audioContext.sampleRate / bufferLength;
	let iterationPeriod = 1 / iterationFrequency;

	let startTime = 0.0;
	let currentTime = 0.0;
	let counter  =0;
	let timer = false;

	//processor
	audioContext.audioWorklet.addModule('audio-processor.js').then(()=>{
		let workletNode = new AudioWorkletNode(audioContext, 'audio-processor');
		workletNode.port.onmessage = (e) =>{
			//console.log(e.data);

			//get data
			analyser.getByteTimeDomainData(timeDomainDataByte)
			analyser.getFloatTimeDomainData(timeDomainDataFloat);
			analyser.getByteFrequencyData(frequencyDomainDataByte);
			analyser.getFloatFrequencyData(frequencyDomainDataFloat);

			//volume
			let volume =0.0;
			let total = 0;
			for (let i = 0; i < analyser.frequencyBinCount; i++) {
				let x = frequencyDomainDataByte[i];
				total += x * x;
			}
			let rms = Math.sqrt(total / analyser.frequencyBinCount);
			volume = 20 * (Math.log(rms) / Math.log(10));
			volume = Math.max(volume, 0); // sanity check
			volumeText.innerHTML = `${Math.floor(volume)} dB`;

			//end of speech detection
			// - create linear data
			let frequencyDomainLinearData = [];
			for (let i = 0; i < analyser.frequencyBinCount; i++) {
				frequencyDomainLinearData[i] = Math.pow(10, frequencyDomainDataFloat[i] / 10);
			}
			//console.log('frequency domain', frequencyDomainDataFloat);
			//console.log('frequency domain linear', frequencyDomainLinearData);

			// - calculate energy
			let energy = 0;
			for (let i = 0; i < analyser.frequencyBinCount; i++) {
				energy += filter[i] * frequencyDomainLinearData[i] * frequencyDomainLinearData[i];
			}
			energyText.innerHTML = `energy:${energy}`;

			let signal = energy - energy_offset;
			if (signal > energy_threshold_pos) {
				voiceTrend = (voiceTrend + 1 > voiceTrendMax) ? voiceTrendMax : voiceTrend + 1;
			} else if (signal < -energy_threshold_neg) {
				voiceTrend = (voiceTrend - 1 < voiceTrendMin) ? voiceTrendMin : voiceTrend - 1;
			} else {
				// voiceTrend gets smaller
				if (voiceTrend > 0) {
					voiceTrend--;
				} else if (voiceTrend < 0) {
					voiceTrend++;
				}
			}
			trendArray.push(voiceTrend);
			trendArray.shift();
			signalText.innerHTML = `signal: ${signal}`;
			trendText.innerHTML = `trend: ${voiceTrend}, signal > threshold: ${signal > energy_threshold_pos}, signal < - threshold: ${signal < -energy_threshold_neg}`;

			let start = false;
			let end = false;

			currentTime = new Date().getTime();
			if (voiceTrend > voiceTrendStart) {
				start = true;

				if(!speechStarted)
				{
					speechStarted = true;
					console.log('Start');

				}

				counter ++;
				timer = false;
			} else if (voiceTrend < voiceTrendEnd) {
				end = true;

				if(counter > 0)
				{
					counter --;
					if( counter == 0)
					{
						startTime = new Date().getTime();
						timer = true;
					}
				}
			}

			if( timer && (currentTime - startTime) > 1000)
			{
				speechStarted = false;
				console.log('recording end');
				timer = false
			}

			startText.innerHTML = `start: ${startTime}`;
			currentText.innerHTML = `current: ${currentTime}`;
			diffText.innerHTML = `diff: ${currentTime - startTime}`;

			let integration = signal * iterationPeriod * energy_integration;
			if (integration > 0 || !end) {
				energy_offset += integration;
			} else {
				energy_offset += integration * 10;
			}
			energy_offset = energy_offset < 0 ? 0 : energy_offset;
			energy_threshold_pos = energy_offset * energy_threshold_ratio_pos;
			energy_threshold_neg = energy_offset * energy_threshold_ratio_neg;

			/*
			CONTINUE WITH VAD
			1. DEBUG ENERGY
			2. VAD
			*/
			/*
			let energy = 0;
			let fft = this.floatFrequencyDataLinear;
			for (var i = 0, iLen = fft.length; i < iLen; i++) {
				energy += this.filter[i] * fft[i] * fft[i];
			}
			*/


		}

		audioStream.connect(analyser);
		audioStream.connect(workletNode).connect(audioContext.destination);

		//visualize
		visualizeSinewave();
		visualizeFrequencyBar();
		visualizeTrend();
	});

	//



}

/*******************
 * Function
 * *****************
 */
function playback(blobURL) {
	if (!document.querySelector('#voice-recorder-playback-controls')) {
		let div = document.createElement('div');
		div.id = 'voice-recorder-playback-controls';
		div.innerHTML = `<audio controls="controls" id="voice-recorder-playback"/>`;
		document.querySelector('body').append(div);
	}

	let audio = document.querySelector('#voice-recorder-playback');
	audio.src = blobURL;
	//audio.play();
}

//
function sampleData(audioBuffer) {
	//sample data
	let rawData = audioBuffer.getChannelData(0);
	let bars = 200;
	let barSize = Math.floor(rawData.length / bars);
	let sampledData = [];
	for (let i = 0; i < bars; i++) {
		//
		let barStart = barSize * i;
		let sum = 0;
		for (let j = 0; j < barSize; j++) {
			sum = sum + Math.abs(rawData[barStart + j]);
		}
		let barValue = sum / barSize;
		sampledData.push(barValue);
	}

	//normalize data
	let normalizedData = sampledData.map(value => value / normalizeStrength);

	//analysis
	let audioRate = 0.0;
	let maxVolume = 0;
	let averageVolume = 0.0;
	for (let i = 0; i < bars; i++) {
		if (normalizedData[i] >= energyThreshold)
			audioRate++;
		maxVolume = Math.max(maxVolume, normalizedData[i]);
		averageVolume += normalizedData[i];
	}
	audioRate = audioRate / bars;

	//
	console.log(`AverageVolume=${averageVolume / bars}, MaxVolume=${maxVolume}, NoiseRate=${audioRate}`);
	if (audioRate >= energyRateThreshold) {
		speechStarted = true;
	}
	if (speechStarted && audioRate <= energyRateThreshold) {
		console.log('End of Speech Detected');
		onClickStop();
	}

	//
	return normalizedData;
}

/**************
 * Visualization
 * *************
 */
//time domain
function visualizeData(data) {
	const canvas = document.getElementById('waveform');
	if (!canvas.getContext) return;

	const context = canvas.getContext('2d');
	context.clearRect(0, 0, canvas.width, canvas.height);

	const width = canvas.width;
	const height = canvas.height;
	const barWidth = width / data.length;

	for (let i = 0; i < data.length; i++) {
		let barX = barWidth * i;
		let barY = (1 - data[i]) / 2 * height;
		let barHeight = height * data[i];

		if (data[i] >= energyThreshold) {
			context.fillStyle = 'rgb(255,0,0)';
		} else {
			context.fillStyle = 'rgb(0,0,0)';
		}
		context.fillRect(barX, barY, barWidth, barHeight);
	}

	context.strokeStyle = 'rgb(0, 255, 0)';
	context.beginPath();
	context.moveTo(0, height / 2);
	context.lineTo(width, height / 2);
	context.stroke();

}

//frequency domain
const canvasFrequency = document.getElementById('frequency_sine');
const contextFrequency = canvasFrequency.getContext('2d');

const WIDTH_FREQUENCY = 800;
const HEIGHT_FREQUENCY = 200;

//oscilloscope
function visualizeSinewave() {
	if (!analyser) return;

	//
	requestAnimationFrame(visualizeSinewave);

	//get data
	analyser.getByteTimeDomainData(timeDomainDataByte);
	let bufferLength = analyser.frequencyBinCount;
	let sliceWidth = WIDTH_FREQUENCY * 1.0 / bufferLength;
	let x = 0;

	//draw
	contextFrequency.fillStyle = 'rgb(200, 200, 200)';
	contextFrequency.fillRect(0, 0, WIDTH_FREQUENCY, HEIGHT_FREQUENCY);
	contextFrequency.lineWidth = 2;
	contextFrequency.strokeStyle = 'rgb(0, 0, 0)';
	contextFrequency.beginPath();
	for (let i = 0; i < bufferLength; i++) {
		let value = timeDomainDataByte[i] / 128.0;
		let y = value * HEIGHT_FREQUENCY / 2.0;

		if (i === 0) {
			contextFrequency.moveTo(x, y);
		} else {
			contextFrequency.lineTo(x, y);
		}
		x += sliceWidth;
	}

	contextFrequency.lineTo(WIDTH_FREQUENCY, HEIGHT_FREQUENCY / 2.0);
	contextFrequency.stroke();
}

//frequency bar
const canvasBar = document.getElementById('frequency_bar');
const contextBar = canvasBar.getContext('2d');

function visualizeFrequencyBar() {
	if (!analyser) return;

	//
	requestAnimationFrame(visualizeFrequencyBar);

	//setup
	analyser.getByteFrequencyData(frequencyDomainDataByte);
	let bufferLength = analyser.frequencyBinCount;
	let barWidth = (WIDTH_FREQUENCY / bufferLength) * 2.5;
	let barHeight;
	let x = 0;

	//draw
	contextBar.fillStyle = 'rgb(0, 0, 0)';
	contextBar.fillRect(0, 0, WIDTH_FREQUENCY, HEIGHT_FREQUENCY);

	for (let i = 0; i < bufferLength; i++) {
		barHeight = frequencyDomainDataByte[i];

		contextBar.fillStyle = 'rgb(' + (barHeight + 100) + ',50,50)';
		contextBar.fillRect(x, HEIGHT_FREQUENCY - barHeight / 2, barWidth, barHeight / 2);

		x += barWidth + 1;
	}
}

//trend graph
const canvasTrend = document.getElementById('trend_graph');
const contextTrend = canvasTrend.getContext('2d');
function visualizeTrend(){
	if (!analyser) return;

	//
	requestAnimationFrame(visualizeTrend);

	//get data
	let sliceWidth = WIDTH_FREQUENCY * 1.0 / 500;
	let x = 0;

	//draw
	contextTrend.fillStyle = 'rgb(200, 200, 200)';
	contextTrend.fillRect(0, 0, WIDTH_FREQUENCY, HEIGHT_FREQUENCY);
	contextTrend.lineWidth = 2;
	contextTrend.strokeStyle = 'rgb(0, 0, 0)';
	contextTrend.beginPath();
	for (let i = 0; i < 500; i++) {
		let value = (trendArray[i] / 10 + 1)/2.0;
		let y = value * HEIGHT_FREQUENCY;
		if (i === 0) {
			contextTrend.moveTo(x, y);
		} else {
			contextTrend.lineTo(x, y);
		}
		x += sliceWidth;
	}

	//console.log(trendArray[0]);

	contextTrend.lineTo(WIDTH_FREQUENCY, HEIGHT_FREQUENCY / 2.0);
	contextTrend.stroke();


}