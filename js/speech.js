/**
 * Speech Recognition handler for native dictation.
 * Interfaces with webkitSpeechRecognition / SpeechRecognition on Android & Desktop.
 */

export class SpeechHandler {
  constructor({ onResult, onStart, onEnd, onError }) {
    this.onResult = onResult || (() => {});
    this.onStart = onStart || (() => {});
    this.onEnd = onEnd || (() => {});
    this.onError = onError || (() => {});

    this.recognition = null;
    this.isListening = false;
    this.initRecognition();
  }

  static isSupported() {
    return typeof window !== 'undefined' && Boolean(
      window.SpeechRecognition ||
      window.webkitSpeechRecognition
    );
  }

  initRecognition() {
    if (!SpeechHandler.isSupported()) return;

    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.recognition = new SpeechRec();
    this.recognition.continuous = false;
    this.recognition.interimResults = true;
    this.recognition.lang = 'en-US';

    this.recognition.onstart = () => {
      this.isListening = true;
      this.onStart();
    };

    this.recognition.onresult = (event) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const item = event.results[i];
        if (item.isFinal) {
          finalTranscript += item[0].transcript;
        } else {
          interimTranscript += item[0].transcript;
        }
      }

      this.onResult({
        final: finalTranscript.trim(),
        interim: interimTranscript.trim()
      });
    };

    this.recognition.onerror = (event) => {
      this.isListening = false;
      this.onError(event.error || 'Speech recognition error');
    };

    this.recognition.onend = () => {
      this.isListening = false;
      this.onEnd();
    };
  }

  start() {
    if (!this.recognition) {
      this.onError('Speech recognition is not supported in this browser.');
      return false;
    }
    if (this.isListening) {
      this.stop();
      return false;
    }

    try {
      this.recognition.start();
      return true;
    } catch (err) {
      this.onError(err.message);
      return false;
    }
  }

  stop() {
    if (this.recognition && this.isListening) {
      try {
        this.recognition.stop();
      } catch (e) {
        // ignore
      }
    }
    this.isListening = false;
  }
}
