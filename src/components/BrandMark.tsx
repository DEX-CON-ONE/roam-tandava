import { brand } from "@/config/brand";
import { cn } from "@/lib/utils";

const SIZES = {
  sm: { tile: "h-8 w-8", letter: "text-sm", name: "text-sm" },
  md: { tile: "h-10 w-10", letter: "text-xl", name: "text-2xl" },
  lg: { tile: "h-20 w-20", letter: "text-4xl", name: "text-3xl" },
} as const;

/**
 * The product mark: the configured logo, or the brand initial in a tile when
 * no logo is set. Optionally followed by the brand name.
 */
export function BrandMark({
  size = "md",
  withName = false,
  name = brand.name,
  className,
  nameClassName,
}: {
  size?: keyof typeof SIZES;
  withName?: boolean;
  /** Overrides the text shown next to the mark (e.g. a studio's own name). */
  name?: string;
  className?: string;
  nameClassName?: string;
}) {
  const s = SIZES[size];
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      {brand.logoUrl ? (
        <span
          className={cn("flex flex-none items-center justify-center rounded-lg p-1", s.tile, !brand.logoBackground && "bg-primary")}
          style={brand.logoBackground ? { backgroundColor: brand.logoBackground } : undefined}
        >
          <img src={brand.logoUrl} alt={withName ? "" : brand.name} className="max-h-full max-w-full object-contain" />
        </span>
      ) : (
        <span className={cn("flex flex-none items-center justify-center rounded-lg bg-primary", s.tile)}>
          <span className={cn("font-bold text-primary-foreground", s.letter)}>{brand.name.charAt(0)}</span>
        </span>
      )}
      {withName && <span className={cn("font-semibold tracking-tight", s.name, nameClassName)}>{name}</span>}
    </span>
  );
}
