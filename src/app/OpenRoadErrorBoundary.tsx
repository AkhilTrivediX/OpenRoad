import React, { type ReactNode } from "react";

import { clearOpenRoadState } from "../domain/openroad";

type OpenRoadErrorBoundaryProps = {
  children: ReactNode;
};

type OpenRoadErrorBoundaryState = {
  error: Error | null;
  localDataCleared: boolean;
  resetKey: number;
};

export class OpenRoadErrorBoundary extends React.Component<
  OpenRoadErrorBoundaryProps,
  OpenRoadErrorBoundaryState
> {
  state: OpenRoadErrorBoundaryState = {
    error: null,
    localDataCleared: false,
    resetKey: 0
  };

  static getDerivedStateFromError(error: Error): Partial<OpenRoadErrorBoundaryState> {
    return {
      error,
      localDataCleared: false
    };
  }

  retry = () => {
    this.setState((state) => ({
      error: null,
      localDataCleared: false,
      resetKey: state.resetKey + 1
    }));
  };

  resetLocalData = () => {
    clearOpenRoadState();
    this.setState({ localDataCleared: true });
  };

  render() {
    if (this.state.error) {
      return (
        <main className="app-shell recovery-shell" aria-label="OpenRoad recovery">
          <section className="recovery-panel" aria-labelledby="recovery-title">
            <span className="recovery-kicker">Recovery</span>
            <h1 id="recovery-title">OpenRoad caught a workspace crash.</h1>
            <p>
              Your data has not been sent anywhere. Try reopening the app first; if local
              browser data is damaged, clear only OpenRoad's local browser state and reload.
            </p>
            <div className="recovery-actions" aria-label="Recovery actions">
              <button className="primary-action" onClick={this.retry} type="button">
                Try again
              </button>
              <button className="secondary-action" onClick={this.resetLocalData} type="button">
                Reset local data
              </button>
            </div>
            {this.state.localDataCleared ? (
              <p className="recovery-note" role="status">
                Local OpenRoad browser data was cleared. Try again to start from seed data.
              </p>
            ) : null}
          </section>
        </main>
      );
    }

    return <React.Fragment key={this.state.resetKey}>{this.props.children}</React.Fragment>;
  }
}
