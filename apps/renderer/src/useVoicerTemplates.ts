import { useEffect, useState } from "react";
import type { DesktopApi, VoicerTemplate } from "@gold-work/shared";

export function useVoicerTemplates(api: DesktopApi, enabled = true) {
  const [templates, setTemplates] = useState<VoicerTemplate[]>([]);
  const [templatesBusy, setTemplatesBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setTemplatesBusy(true);
    setError(null);
    void api.listVoicerTemplates()
      .then((items) => { if (active) setTemplates(items); })
      .catch((reason: unknown) => {
        if (!active) return;
        const message = reason instanceof Error ? reason.message : String(reason);
        setError(message
          .replace(/^Error invoking remote method 'voicer:templates':\s*/i, "")
          .replace(/^(?:VoicerClientError|Error):\s*/, "")
          .replace(/^\[no-retry\]\s*/, "")
          .trim() || "Причина неизвестна.");
      })
      .finally(() => { if (active) setTemplatesBusy(false); });
    return () => { active = false; };
  }, [api, enabled, revision]);

  const templatesStatus = templatesBusy ? "Загружаю шаблоны Lumean…"
    : error ? `Не удалось загрузить шаблоны Lumean. ${error}`
    : templates.length ? `Шаблонов Lumean: ${templates.length}`
    : "В Lumean нет шаблонов ElevenLabs.";

  return { templates, templatesBusy, templatesStatus, refreshTemplates: () => setRevision((value) => value + 1) };
}
