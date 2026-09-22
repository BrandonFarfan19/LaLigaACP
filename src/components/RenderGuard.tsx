import { Component, type ReactNode } from 'react';

interface RenderGuardProps {
	/** What to show instead when `children` throws while rendering. */
	fallback: ReactNode;
	/** A new value clears the error and tries `children` again. */
	resetKey: unknown;
	children: ReactNode;
}

interface RenderGuardState {
	failed: boolean;
	resetKey: unknown;
}

/**
 * Keeps a render error inside one part of a page (T-19 fix): a broken ticket
 * panel shows its fallback instead of turning the whole route into the error
 * page. Only an error boundary (a class) can catch it.
 */
export default class RenderGuard extends Component<RenderGuardProps, RenderGuardState> {
	state: RenderGuardState = { failed: false, resetKey: this.props.resetKey };

	static getDerivedStateFromError(): Partial<RenderGuardState> {
		return { failed: true };
	}

	static getDerivedStateFromProps(props: RenderGuardProps, state: RenderGuardState): Partial<RenderGuardState> | null {
		return props.resetKey === state.resetKey ? null : { failed: false, resetKey: props.resetKey };
	}

	render() {
		return this.state.failed ? this.props.fallback : this.props.children;
	}
}
