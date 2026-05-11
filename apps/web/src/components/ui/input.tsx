import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * `<Input>` — base text-input. Focus-стиль:
 *   - `focus-visible` only (mouse-click не подсвечивает)
 *   - border меняется на `ring`-color
 *   - 4px halo с opacity 15% (`ring-ring/15`) — мягкое свечение
 *   - smooth transition 200ms (border + shadow + bg)
 *
 * Hover'е тёмная граница для signal'а интерактивности. Disabled приходит
 * последним и побеждает hover/focus стили.
 */
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // Layout
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm",
          // File input bits
          "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
          "placeholder:text-muted-foreground",
          // Smooth transitions for hover/focus state changes
          "transition-[border-color,box-shadow,background-color] duration-200 motion-reduce:transition-none",
          // Hover (only when not focused/disabled)
          "hover:border-foreground/25",
          // Focus
          "focus-visible:outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15",
          // Disabled
          "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-input",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
