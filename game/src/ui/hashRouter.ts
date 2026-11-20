import { formatRoute, parseRoute, type Route } from './router';

/** Listens to hashchange and reports parsed routes. DOM wiring only. */
export class HashRouter {
  private readonly onHash = (): void => this.listener(parseRoute(window.location.hash));

  constructor(private readonly listener: (route: Route) => void) {}

  start(): void {
    window.addEventListener('hashchange', this.onHash);
    this.onHash();
  }

  navigate(route: Route): void {
    const hash = formatRoute(route);
    if (window.location.hash === hash) this.onHash();
    else window.location.hash = hash;
  }
}
