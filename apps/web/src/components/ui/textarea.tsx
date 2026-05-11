import * as React from "react";

import { cn } from "@/lib/utils";

/** `<Textarea>` — multiline-input. Сматчен с `<Input>` по focus/hover/disabled
 *  паттернам. Default `min-h-[80px]`, caller может override через className. */
const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
        "placeholder:text-muted-foreground",
        "transition-[border-color,box-shadow,background-color] duration-200 motion-reduce:transition-none",
        "hover:border-foreground/25",
        "focus-visible:outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15",
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-input",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";

export { Textarea };
