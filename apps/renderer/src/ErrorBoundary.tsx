import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Ловит ошибки рендера, чтобы вместо чёрного экрана показать текст ошибки и записать её в лог приложения. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    void window.goldWork?.writeLog("error", "renderer.crash", {
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack
    });
  }

  private reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div style={{ padding: "40px", color: "#f5f5f7", fontFamily: "system-ui, sans-serif", maxWidth: 960, margin: "0 auto" }}>
        <h1 style={{ fontSize: 22, marginBottom: 8 }}>Что-то пошло не так</h1>
        <p style={{ opacity: 0.8, marginBottom: 16 }}>
          Интерфейс перехватил ошибку и не закрылся. Скопируйте текст ниже и пришлите разработчику — по нему видно причину.
        </p>
        <pre style={{ whiteSpace: "pre-wrap", background: "#16171d", padding: 16, borderRadius: 10, fontSize: 12, lineHeight: 1.5, overflow: "auto", maxHeight: 420 }}>
          {`${error.message}\n\n${error.stack ?? ""}`}
        </pre>
        <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
          <button onClick={this.reset} style={{ padding: "8px 16px", borderRadius: 8, cursor: "pointer" }}>Попробовать снова</button>
          <button onClick={() => location.reload()} style={{ padding: "8px 16px", borderRadius: 8, cursor: "pointer" }}>Перезагрузить интерфейс</button>
        </div>
      </div>
    );
  }
}
