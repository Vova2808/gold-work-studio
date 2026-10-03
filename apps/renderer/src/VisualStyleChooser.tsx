import { Check } from "lucide-react";
import { IMAGE_STYLES } from "@gold-work/shared";

/** Shared by the new-video form, scenario and settings: the same pictures and rules. */
export function VisualStyleChooser({ value, onChange, compact = false }: { value: string; onChange: (value: string) => void; compact?: boolean }) {
  const preset = IMAGE_STYLES.find(style => style.promptSuffix === value.trim());
  return <div className={`visual-style-chooser${compact ? " compact" : ""}`}>
    <div className="visual-style-options" role="radiogroup" aria-label="Готовые стили рисовки">
      {IMAGE_STYLES.map(style => <button type="button" role="radio" aria-checked={value.trim() === style.promptSuffix}
        key={style.id} className={value.trim() === style.promptSuffix ? "selected" : ""} title={style.label} onClick={() => onChange(style.promptSuffix)}>
        <img src={`/styles/${style.id}.jpg`} alt={`Пример стиля: ${style.label}`} loading="lazy" /><span>{style.label}</span>
        {value.trim() === style.promptSuffix && <Check size={14} />}
      </button>)}
    </div>
    <label className="visual-style-custom"><span>Свой стиль{preset ? ` · сейчас «${preset.label}»` : ""}</span>
      <textarea rows={compact ? 2 : 3} value={value} maxLength={2000} aria-label="Описание стиля изображений"
        placeholder="Техника рисовки, контур, палитра, свет. Внешность каждого персонажа задаётся отдельно."
        onChange={event => onChange(event.target.value)} />
      <small>Единая техника рисовки для всех портретов и кадров. Здесь не нужно описывать конкретную сцену.</small>
    </label>
  </div>;
}
