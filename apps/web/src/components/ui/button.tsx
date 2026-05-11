"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { useRipple } from "@/lib/use-ripple";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // Не ставим `overflow-hidden` на саму кнопку — иначе клипается badge у
  // CartButton/FavoritesHeaderButton (`-right-1 -top-1`). Ripple клипается
  // собственным wrapper'ом (`overflow-hidden rounded-[inherit]` в useRipple),
  // так что круг всё равно остаётся внутри границ.
  "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[background-color,box-shadow,transform,color] duration-200 motion-reduce:transition-none active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, onPointerDown, children, ...props }, ref) => {
    // asChild = true → Slot прокидывает класс/реф в child (обычно `<Link>`).
    // Slot требует ровно один React-element child, поэтому ripple-spans
    // в этом случае не вставляем — Link и так имеет hover/focus-эффекты.
    if (asChild) {
      return (
        <Slot
          className={cn(buttonVariants({ variant, size, className }))}
          ref={ref}
          {...(onPointerDown ? { onPointerDown } : {})}
          {...props}
        >
          {children}
        </Slot>
      );
    }
    return (
      <PlainButton
        className={className}
        variant={variant}
        size={size}
        onPointerDown={onPointerDown}
        ref={ref}
        {...props}
      >
        {children}
      </PlainButton>
    );
  },
);
Button.displayName = "Button";

interface PlainButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

const PlainButton = React.forwardRef<HTMLButtonElement, PlainButtonProps>(
  ({ className, variant, size, onPointerDown, children, ...props }, ref) => {
    const { ripples, onPointerDown: rippleDown } = useRipple();
    const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>): void => {
      rippleDown(event);
      onPointerDown?.(event);
    };
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        onPointerDown={handlePointerDown}
        {...props}
      >
        {children}
        {ripples}
      </button>
    );
  },
);
PlainButton.displayName = "PlainButton";

export { Button, buttonVariants };
