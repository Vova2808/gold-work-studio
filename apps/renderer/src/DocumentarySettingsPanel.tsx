import type { ProjectSettings } from "@gold-work/shared";
import { StockMontageChoices } from "./StockMontageChoices";

export function DocumentarySettingsPanel({ assembly, onChange }: { assembly: ProjectSettings["assembly"]; onChange: (assembly: ProjectSettings["assembly"]) => void }) {
  return <section className="settings-panel documentary-settings"><h3>ХАРАКТЕР МОНТАЖА</h3>
    <StockMontageChoices assembly={assembly} onChange={onChange} />
  </section>;
}
