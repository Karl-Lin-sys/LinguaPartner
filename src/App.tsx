import React, { useEffect, useState, useRef } from 'react';
import { motion } from 'motion/react';
import { Mic, MicOff, Volume2, Loader2, Play } from 'lucide-react';
import { pcmToBase64, base64ToArrayBuffer, pcm16BitToFloat32 } from './lib/audioUtils';

export default function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [transcript, setTranscript] = useState<string>('');
  const [selectedLang, setSelectedLang] = useState<string>('Spanish');
  
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  // Buffer to queue up transcripts so they don't overwrite instantly
  const transcriptBuffer = useRef<string[]>([]);
  const transcriptTimeout = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      stopSession();
    };
  }, []);

  const playAudioChunk = (base64Audio: string) => {
    if (!audioContextRef.current) return;
    
    try {
      const buffer = base64ToArrayBuffer(base64Audio);
      const float32Data = pcm16BitToFloat32(buffer);
      
      const audioBuffer = audioContextRef.current.createBuffer(1, float32Data.length, 24000); 
      // NOTE: Gemini Flash Voice generates audio at 24kHz natively (as mentioned in TTS examples)
      // Actually Live API returns PCM 24000Hz. Let's make sure! 
      audioBuffer.getChannelData(0).set(float32Data);

      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContextRef.current.destination);

      const currentTime = audioContextRef.current.currentTime;
      if (nextStartTimeRef.current < currentTime) {
        nextStartTimeRef.current = currentTime;
      }
      
      source.start(nextStartTimeRef.current);
      nextStartTimeRef.current += audioBuffer.duration;
    } catch (e) {
      console.error("Audio playback error:", e);
    }
  };

  const startSession = async () => {
    setIsConnecting(true);
    setTranscript('');
    try {
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${window.location.host}/live?lang=${encodeURIComponent(selectedLang)}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      audioContextRef.current = audioCtx;
      nextStartTimeRef.current = 0;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const source = audioCtx.createMediaStreamSource(stream);
      sourceRef.current = source;
      
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      source.connect(processor);
      processor.connect(audioCtx.destination);

      ws.onopen = () => {
        setIsConnected(true);
        setIsConnecting(false);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          
          if (msg.audio) {
            playAudioChunk(msg.audio);
          }
          
          if (msg.interrupted) {
            // Stop playback, clear queue
            nextStartTimeRef.current = audioCtx.currentTime;
          }

          if (msg.aiTranscription) {
            transcriptBuffer.current.push(msg.aiTranscription);
            updateTranscript();
          }
          
          if (msg.error) {
            console.error("Server error:", msg.error);
          }
        } catch (e) {
          console.error("Message parsing error:", e);
        }
      };

      ws.onclose = () => {
        stopSession();
      };

      // We need to queue the sending logic because we can only send when WS is OPEN.
      processor.onaudioprocess = (e) => {
        if (!isMuted && ws.readyState === WebSocket.OPEN) {
          const base64 = pcmToBase64(e.inputBuffer.getChannelData(0));
          ws.send(JSON.stringify({ audio: base64 }));
        }
      };

    } catch (err) {
      console.error("Start session error:", err);
      setIsConnecting(false);
      stopSession();
    }
  };

  const stopSession = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(console.error);
      audioContextRef.current = null;
    }
    
    setIsConnected(false);
    setIsConnecting(false);
  };

  const updateTranscript = () => {
    if (transcriptTimeout.current) return; // Wait
    const update = () => {
      const nextWord = transcriptBuffer.current.shift();
      if (nextWord) {
        setTranscript(prev => {
          const newText = prev + " " + nextWord;
          // limit length of string? 
          return newText.length > 200 ? "..." + newText.slice(-200) : newText;
        });
        transcriptTimeout.current = setTimeout(update, nextWord.length * 50); // rough pacing 
      } else {
        transcriptTimeout.current = null;
        // Optionally clear down after some time?
      }
    };
    update();
  };

  const toggleMute = () => {
    setIsMuted(!isMuted);
    if (streamRef.current) {
      streamRef.current.getAudioTracks().forEach(track => {
        track.enabled = isMuted; // Toggle enablement
      });
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 relative overflow-hidden font-sans">
      
      {/* Background decorations - Atmospheric/Immersive vibe */}
      <div className="absolute top-0 w-full h-full pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-blue-600/20 rounded-full blur-[120px] mix-blend-screen mix-blend-color-dodge mix-blend-overlay"></div>
        <div className="absolute bottom-1/4 right-1/4 w-[600px] h-[600px] bg-purple-600/20 rounded-full blur-[140px] mix-blend-screen mix-blend-color-dodge"></div>
      </div>

      <div className="w-full max-w-2xl z-10 flex flex-col items-center gap-12">
        <div className="text-center space-y-4">
          <h1 className="text-5xl font-light tracking-tight bg-gradient-to-br from-white to-slate-400 bg-clip-text text-transparent">
            LinguaPartner
          </h1>
          <p className="text-slate-400 font-light text-lg">Your real-time conversational AI.</p>
        </div>

        {/* Status Bubble */}
        <div className="relative">
          <motion.div 
            animate={{ 
              scale: isConnected && !isMuted ? [1, 1.05, 1] : 1,
              opacity: isConnected ? 1 : 0.5
            }}
            transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
            className={`w-48 h-48 rounded-full flex items-center justify-center relative ${isConnected ? 'bg-gradient-to-tr from-blue-500 to-purple-500 shadow-2xl shadow-blue-500/20' : 'bg-slate-800 border border-slate-700'}`}
          >
            {isConnected ? (
              <Volume2 className="w-16 h-16 text-white" />
            ) : isConnecting ? (
              <Loader2 className="w-16 h-16 text-slate-400 animate-spin" />
            ) : (
              <p className="text-slate-400 text-sm font-medium tracking-wide uppercase">Offline</p>
            )}
          </motion.div>
        </div>

        {/* Transcript Area */}
        <div className="w-full min-h-24 px-8 py-6 rounded-2xl bg-white/5 backdrop-blur-xl border border-white/10 text-center flex flex-col justify-center items-center">
           {!isConnected && !isConnecting && (
              <p className="text-slate-500 italic">Press start to begin practicing...</p>
           )}
           {isConnected && (
             <p className="text-xl text-slate-200 leading-relaxed font-light min-h-[1.5em] transition-all">
                {transcript || (
                  <span className="text-slate-500 text-sm animate-pulse">Say something...</span>
                )}
             </p>
           )}
        </div>

        {/* Controls */}
        <div className="flex flex-col gap-6 items-center">
          {!isConnected ? (
            <>
              <div className="flex flex-col items-center gap-3 w-full max-w-xs">
                <label className="text-slate-400 text-sm font-medium">Select Language</label>
                <select 
                  value={selectedLang}
                  onChange={(e) => setSelectedLang(e.target.value)}
                  disabled={isConnecting}
                  className="w-full bg-white/10 border border-white/20 text-white rounded-lg px-4 py-3 outline-none focus:border-blue-500 transition-colors cursor-pointer disabled:opacity-50 appearance-none"
                >
                  <option value="Spanish" className="bg-slate-800">Spanish</option>
                  <option value="French" className="bg-slate-800">French</option>
                  <option value="German" className="bg-slate-800">German</option>
                  <option value="Japanese" className="bg-slate-800">Japanese</option>
                  <option value="Italian" className="bg-slate-800">Italian</option>
                  <option value="English" className="bg-slate-800">English</option>
                  <option value="Mandarin Chinese" className="bg-slate-800">Mandarin Chinese</option>
                </select>
              </div>

              <button 
                onClick={startSession}
                disabled={isConnecting}
                className="flex items-center gap-3 bg-white text-slate-950 px-8 py-4 rounded-full font-medium hover:bg-slate-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-4"
              >
                {isConnecting ? <Loader2 className="w-5 h-5 animate-spin"/> : <Play className="w-5 h-5"/>}
                {isConnecting ? 'Connecting...' : 'Start Practicing'}
              </button>
            </>
          ) : (
            <div className="flex gap-6 items-center mt-4">
              <button
                onClick={toggleMute}
                className={`p-5 rounded-full backdrop-blur-md border border-white/10 transition-colors ${isMuted ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30' : 'bg-white/10 hover:bg-white/20 text-white'}`}
              >
                {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
              </button>
              <button
                onClick={stopSession}
                className="bg-red-500/90 text-white px-8 py-4 rounded-full font-medium hover:bg-red-600 transition-colors"
              >
                End Session
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
