import { useAudio } from './hooks/useAudio';

export default function App() {
  const { isRecording, status, start, stop } = useAudio();

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center gap-6">
      <h1 className="text-3xl font-bold tracking-tight">Blaise — PCM Test</h1>
      <p className="text-gray-400">
        Status: <span className="text-green-400 font-mono">{status}</span>
      </p>
      <button
        onClick={isRecording ? stop : start}
        className={`px-8 py-3 rounded-lg font-semibold transition-colors ${
          isRecording
            ? 'bg-red-600 hover:bg-red-700'
            : 'bg-blue-600 hover:bg-blue-700'
        }`}
      >
        {isRecording ? 'Stop' : 'Start Recording'}
      </button>
      {isRecording && (
        <p className="text-sm text-gray-500">Watch the server console for PCM chunk sizes</p>
      )}
    </div>
  );
}
