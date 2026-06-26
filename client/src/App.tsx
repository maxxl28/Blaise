import { useAudio, type BlaiseStatus } from './hooks/useAudio';

const STATUS_META: Record<BlaiseStatus, { label: string; cls: string }> = {
  idle: { label: 'Listening', cls: 'bg-gray-700 text-gray-300' },
  thinking: { label: 'Blaise is thinking…', cls: 'bg-yellow-600/80 text-white animate-pulse' },
  speaking: { label: 'Blaise is speaking', cls: 'bg-green-600 text-white' },
  silent: { label: 'Blaise stayed silent', cls: 'bg-gray-600 text-gray-200' },
};

export default function App() {
  const { isRecording, status, transcript, interim, replies, blaiseStatus, error, start, stop } = useAudio();
  const meta = STATUS_META[blaiseStatus];

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center py-10 gap-6">
      <header className="flex flex-col items-center gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Blaise</h1>
        <p className="text-gray-500 text-sm font-mono">{status}</p>
      </header>

      <button
        onClick={isRecording ? stop : start}
        className={`px-8 py-3 rounded-lg font-semibold transition-colors ${
          isRecording ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
        }`}
      >
        {isRecording ? 'Stop' : 'Start Recording'}
      </button>

      {isRecording && (
        <span className={`px-4 py-1.5 rounded-full text-sm font-medium ${meta.cls}`}>
          {meta.label}
        </span>
      )}

      {error && (
        <p className="text-red-400 text-sm font-mono max-w-xl text-center">⚠ {error}</p>
      )}

      <div className="w-full max-w-2xl grid grid-cols-1 md:grid-cols-2 gap-4 px-4">
        {/* Live transcript */}
        <section className="bg-gray-800 rounded-xl p-4 flex flex-col gap-2 min-h-[16rem]">
          <h2 className="text-xs uppercase tracking-wider text-gray-500 font-semibold">Transcript</h2>
          <div className="flex flex-col gap-1.5 text-sm overflow-y-auto">
            {transcript.length === 0 && !interim && (
              <p className="text-gray-600 italic">Say something…</p>
            )}
            {transcript.map((line, i) => (
              <p key={i}>
                <span className="text-blue-400 font-mono mr-1">
                  {line.speaker === null ? '·' : `S${line.speaker}`}
                </span>
                <span className="text-gray-200">{line.text}</span>
              </p>
            ))}
            {interim && <p className="text-gray-500 italic">{interim}</p>}
          </div>
        </section>

        {/* Blaise's replies */}
        <section className="bg-gray-800 rounded-xl p-4 flex flex-col gap-2 min-h-[16rem]">
          <h2 className="text-xs uppercase tracking-wider text-gray-500 font-semibold">Blaise</h2>
          <div className="flex flex-col gap-2 text-sm overflow-y-auto">
            {replies.length === 0 && (
              <p className="text-gray-600 italic">No interjections yet.</p>
            )}
            {replies.map((r, i) => (
              <p key={i} className="bg-green-900/40 text-green-100 rounded-lg px-3 py-2">{r}</p>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
