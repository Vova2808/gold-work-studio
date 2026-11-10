import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import "./styles.css";

function DesktopApp() {
  if (!window.goldWork) {
    throw new Error("Нет связи интерфейса с Gold Work Studio. Работа с проектами недоступна. Закройте окно и запустите программу через START-GoldWork.cmd после успешной сборки. Данные проекта этим сообщением не изменяются.");
  }
  return <App />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <DesktopApp />
    </ErrorBoundary>
  </StrictMode>
);

