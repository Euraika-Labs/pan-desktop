import { useEffect, useState } from "react";
import icon from "../../assets/icon.png";
import { ArrowRight, Refresh, Copy } from "../../assets/icons";

interface WelcomeProps {
  error: string | null;
  onStart: () => void;
  onRecheck: () => void;
}

interface InstallInstructions {
  supported: boolean;
  heading: string;
  body: string;
  manualCommand?: string;
}

function Welcome({
  error,
  onStart,
  onRecheck,
}: WelcomeProps): React.JSX.Element {
  // Install command lives in the main process (see installer.ts
  // getInstallInstructions). The renderer NEVER authors install command
  // strings — it fetches them via IPC on mount. This upholds the invariant
  // "No install/update command strings in src/renderer/" from
  // docs/ARCHITECTURE_OVERVIEW.md §Invariants.
  const [instructions, setInstructions] = useState<InstallInstructions | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    window.hermesAPI.getInstallInstructions().then((data) => {
      if (!cancelled) setInstructions(data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const manualCommand = instructions?.manualCommand;
  // On platforms where Pan Desktop can't install Hermes Agent itself
  // (Windows, for M1), the user has to install manually via Git Bash
  // and then come back. Show a "Check again" button so they have a
  // path forward without killing and relaunching the app.
  const showRecheckButton = instructions !== null && !instructions.supported;

  return (
    <div className="screen welcome-screen">
      <img src={icon} height={40} width={40} alt="" />

      {error ? (
        <>
          <h1 className="welcome-title">Installation Issue</h1>
          <p className="welcome-subtitle">{error}</p>

          <div className="welcome-actions">
            {instructions?.supported && (
              <button
                className="btn btn-primary welcome-button"
                onClick={onStart}
              >
                Retry Installation
                <Refresh size={16} />
              </button>
            )}

            {manualCommand && (
              <>
                <div className="welcome-divider">
                  <span>or</span>
                </div>

                <div className="welcome-terminal-option">
                  <p className="welcome-terminal-label">
                    Install via terminal, then come back:
                  </p>
                  <div className="welcome-terminal-box">
                    <code>{manualCommand}</code>
                    <button
                      className="btn-ghost welcome-copy-btn"
                      onClick={() =>
                        navigator.clipboard.writeText(manualCommand)
                      }
                      title="Copy to clipboard"
                    >
                      <Copy size={14} />
                    </button>
                  </div>
                </div>
              </>
            )}

            <button
              className="btn btn-secondary welcome-recheck-btn"
              onClick={onRecheck}
            >
              I&apos;ve installed it — check again
            </button>
          </div>
        </>
      ) : (
        <>
          <h1 className="welcome-title">Welcome to Pan Desktop</h1>
          <p className="welcome-subtitle">
            Your self-improving AI assistant that runs locally on your machine.
            Private, powerful, and always learning.
          </p>
          {instructions?.supported ? (
            <>
              <button
                className="btn btn-primary welcome-button"
                onClick={onStart}
              >
                Get Started
                <ArrowRight size={16} />
              </button>
              <p className="welcome-note">
                This will install required components (~2 GB)
              </p>
            </>
          ) : showRecheckButton ? (
            <div className="welcome-actions">
              <p className="welcome-subtitle">{instructions?.body}</p>
              <button
                className="btn btn-primary welcome-button"
                onClick={onRecheck}
              >
                I&apos;ve installed it — check again
                <Refresh size={16} />
              </button>
              <p className="welcome-note">
                Pan Desktop will auto-detect Hermes Agent once the install
                completes.
              </p>
            </div>
          ) : (
            <p className="welcome-subtitle">Checking your platform…</p>
          )}
        </>
      )}
    </div>
  );
}

export default Welcome;
