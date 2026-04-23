import { Component, type ErrorInfo, type ReactNode } from "react";
import { logError } from "@/services/errorLogService";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("[ErrorBoundary]", error.message, errorInfo.componentStack);
    // M5: envia pro backend pra rastrear crashes silenciosos
    void logError({
      source: "react-error-boundary",
      level: "error",
      message: error.message,
      stack: error.stack || String(errorInfo.componentStack || ""),
      meta: { componentStack: errorInfo.componentStack },
    });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    if (this.props.fallback) {
      return this.props.fallback;
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-destructive"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-foreground">
              Algo deu errado
            </h2>
          </div>

          <p className="mb-2 text-sm text-muted-foreground">
            Ocorreu um erro inesperado. Tente novamente ou recarregue a pagina.
          </p>

          {this.state.error && (
            <pre className="mb-4 max-h-24 overflow-auto rounded bg-muted p-2 text-xs text-muted-foreground">
              {this.state.error.message}
            </pre>
          )}

          {/* Detecta o erro caracteristico de DOM mutation causado pelo
              Google Tradutor do Chrome (ou extensoes similares) reescrevendo
              text nodes enquanto o React reconcilia o virtual DOM. Orienta
              o usuario a desativar a traducao automatica. */}
          {this.state.error &&
            /insertBefore|removeChild|Failed to execute.*on 'Node'|nao e filho|not a child/i.test(
              this.state.error.message
            ) && (
              <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                <p className="mb-1 font-semibold">
                  Esse erro costuma ser causado pelo Google Tradutor do Chrome.
                </p>
                <p>
                  Clique com o botao direito na pagina → escolha{" "}
                  <strong>&quot;Nunca traduzir este site&quot;</strong>, ou clique
                  no icone de traducao ao lado da barra de endereco e desative a
                  traducao automatica. Depois recarregue a pagina.
                </p>
              </div>
            )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={this.handleRetry}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Tentar novamente
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className="rounded-md border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
            >
              Recarregar pagina
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
