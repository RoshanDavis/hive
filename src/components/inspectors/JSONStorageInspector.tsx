import type { InspectorProps } from "./types";

interface JSONStorageRecord {
  id: string;
  timestamp: string;
  source: string;
  content: string;
}

export default function JSONStorageInspector({
  node,
  onUpdate,
  isRunning,
}: InspectorProps) {
  const records = (node.data?.records as JSONStorageRecord[]) || [];

  const handleClear = () => {
    onUpdate(node.id, {
      ...node.data,
      records: [],
    });
  };

  const handleExportCSV = () => {
    if (records.length === 0) return;

    // Construct CSV content
    const headers = ["ID", "Timestamp", "Source", "Content"];
    const rows = records.map(r => [
      r.id,
      r.timestamp,
      r.source,
      `"${r.content.replace(/"/g, '""')}"` // escape double quotes
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.join(","))
    ].join("\n");

    // Download triggers
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `${node.data?.label || "json_storage"}_export.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="border-t border-border-subtle pt-4 flex flex-col gap-4 h-[calc(100vh-280px)] min-h-95">
      <div className="flex justify-between items-center mb-1">
        <div className="text-[11px] uppercase tracking-widest font-bold text-text-muted">JSON Storage File</div>
        <div className="text-[11px] font-bold text-accent bg-accent-glow px-2 py-0.5 rounded-sm">
          {records.length} records
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-primary border border-border-subtle rounded-md flex flex-col mb-2">
        {records.length > 0 ? (
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-card border-b border-border-subtle text-text-secondary font-semibold uppercase tracking-wider">
                <th className="p-3 w-20">Time</th>
                <th className="p-3 w-22.5">Source</th>
                <th className="p-3">Content</th>
              </tr>
            </thead>
            <tbody>
              {records.map((rec) => (
                <tr key={rec.id} className="border-b border-border-subtle hover:bg-card-hover transition-colors text-text-main">
                  <td className="p-3 text-text-secondary whitespace-nowrap">{rec.timestamp}</td>
                  <td className="p-3 whitespace-nowrap">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                      rec.source.toLowerCase() === "user" || rec.source.toLowerCase() === "you"
                        ? "bg-accent-glow text-accent border border-accent-dim/30"
                        : "bg-input text-text-secondary border border-border-subtle"
                    }`}>
                      {rec.source}
                    </span>
                  </td>
                  <td className="p-3 font-mono leading-relaxed whitespace-pre-wrap break-all">{rec.content}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="flex flex-col items-center justify-center flex-1 text-text-muted gap-2 py-8 text-center px-4">
            <span className="text-3xl opacity-50">💾</span>
            <span className="text-xs font-medium">Storage is empty</span>
            <span className="text-[10px] text-text-muted leading-relaxed max-w-50">
              Connect the Chat node's bottom handle to this JSON Storage node to log conversation histories.
            </span>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <button
          className="flex-1 bg-card border border-border-subtle hover:bg-card-hover text-text-main rounded-md py-2.5 text-xs font-semibold cursor-pointer transition-all flex justify-center items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={handleExportCSV}
          disabled={records.length === 0}
        >
          📥 Export CSV
        </button>
        <button
          className="flex-1 bg-transparent border border-dashed border-border-subtle text-text-secondary hover:border-[#ff6b6b] hover:text-[#ff6b6b] hover:bg-[rgba(255,107,107,0.1)] rounded-md py-2.5 text-xs font-semibold cursor-pointer transition-all flex justify-center items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={handleClear}
          disabled={records.length === 0 || isRunning}
        >
          🧹 Clear Data
        </button>
      </div>
    </div>
  );
}
