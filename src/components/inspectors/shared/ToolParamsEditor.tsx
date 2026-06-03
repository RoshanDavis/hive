import { formInputClass, formLabelClass } from "@/components/shared/FormField";

/** One model-facing parameter row authored for a user tool. */
export interface ToolParam {
  name: string;
  type: "string" | "number" | "boolean";
  description: string;
  required: boolean;
}

/** Assemble an OpenAI/JSON-Schema `parameters` object from the authored rows. */
export function paramsToJsonSchema(params: ToolParam[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const p of params) {
    const name = p.name.trim();
    if (!name) continue;
    properties[name] = {
      type: p.type,
      ...(p.description.trim() ? { description: p.description.trim() } : {}),
    };
    if (p.required) required.push(name);
  }
  return { type: "object", properties, ...(required.length ? { required } : {}) };
}

interface ToolParamsEditorProps {
  value: ToolParam[];
  onChange: (next: ToolParam[]) => void;
}

/**
 * Lightweight editor for a user tool's call parameters. Each row is name + type +
 * description + required; {@link paramsToJsonSchema} turns the rows into the JSON
 * Schema offered to the model. Shared by the HTTP- and script-tool authoring forms.
 */
export default function ToolParamsEditor({ value, onChange }: ToolParamsEditorProps) {
  const update = (i: number, patch: Partial<ToolParam>) =>
    onChange(value.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const add = () =>
    onChange([...value, { name: "", type: "string", description: "", required: false }]);

  return (
    <div className="flex flex-col gap-2">
      <label className={formLabelClass}>Parameters (what the model fills in)</label>
      {value.length === 0 && (
        <p className="text-[11px] text-text-muted/80 italic m-0">
          No parameters — the tool takes no arguments.
        </p>
      )}
      {value.map((p, i) => (
        <div key={i} className="flex flex-col gap-1 border border-border-subtle rounded-md p-2">
          <div className="flex items-center gap-2">
            <input
              className={`${formInputClass} flex-1`}
              type="text"
              value={p.name}
              placeholder="name"
              onChange={(e) => update(i, { name: e.target.value })}
            />
            <select
              className={`${formInputClass} cursor-pointer`}
              value={p.type}
              onChange={(e) => update(i, { type: e.target.value as ToolParam["type"] })}
            >
              <option value="string">string</option>
              <option value="number">number</option>
              <option value="boolean">boolean</option>
            </select>
            <button
              type="button"
              onClick={() => remove(i)}
              className="text-text-muted hover:text-danger border border-border-subtle rounded px-1.5 cursor-pointer bg-card hover:bg-card-hover text-[11px]"
              title="Remove parameter"
            >
              ×
            </button>
          </div>
          <input
            className={formInputClass}
            type="text"
            value={p.description}
            placeholder="description (shown to the model)"
            onChange={(e) => update(i, { description: e.target.value })}
          />
          <label className="flex items-center gap-1.5 text-[11px] text-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={p.required}
              onChange={(e) => update(i, { required: e.target.checked })}
            />
            Required
          </label>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="self-start text-[11px] text-text-muted hover:text-text-main border border-dashed border-border-subtle hover:border-border-card rounded-md px-2 py-1 cursor-pointer bg-transparent transition-colors"
      >
        ＋ Add parameter
      </button>
    </div>
  );
}
