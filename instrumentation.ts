// Runs once on server startup before any route handler.
// Polyfills browser globals that pdfjs-dist (used by pdf-parse) requires in Node.js.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const g = globalThis as Record<string, unknown>;

    if (!g.DOMMatrix) {
      g.DOMMatrix = class DOMMatrix {
        m11=1; m12=0; m13=0; m14=0;
        m21=0; m22=1; m23=0; m24=0;
        m31=0; m32=0; m33=1; m34=0;
        m41=0; m42=0; m43=0; m44=1;
        is2D=true; isIdentity=true;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        transformPoint(p: any) { return { x: p?.x ?? 0, y: p?.y ?? 0, z: 0, w: 1 }; }
        multiply() { return this; }
        translate() { return this; }
        scale() { return this; }
        inverse() { return this; }
      };
    }

    if (!g.DOMPoint) {
      g.DOMPoint = class DOMPoint {
        x=0; y=0; z=0; w=1;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        constructor(x=0, y=0, z=0, w=1) { this.x=x; this.y=y; this.z=z; this.w=w; }
      };
    }

    if (!g.Path2D) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      g.Path2D = class Path2D {} as any;
    }
  }
}
