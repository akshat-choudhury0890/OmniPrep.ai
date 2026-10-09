import { Link } from "@tanstack/react-router";

export function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2 font-pixel text-xs sm:text-sm text-foreground">
      <svg viewBox="0 0 8 8" className="pixelated h-6 w-6" aria-hidden shapeRendering="crispEdges">
        <rect x="1" y="1" width="6" height="6" className="fill-accent" />
        <rect x="2" y="2" width="4" height="4" className="fill-background" />
        <rect x="3" y="3" width="2" height="2" className="fill-primary" />
      </svg>
      <span>
        OmniPrep<span className="text-accent">.ai</span>
      </span>
    </Link>
  );
}
