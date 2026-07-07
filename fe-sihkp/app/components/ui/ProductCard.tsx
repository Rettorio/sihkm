import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "~/lib/utils"

const productCardVariants = cva(
  "flex flex-col gap-3 rounded-[32px] px-8 py-8 text-white",
  {
    variants: {
      variant: {
        coral: "bg-[var(--brand-coral)]",
        magenta: "bg-[var(--brand-magenta)]",
        blue: "bg-[var(--brand-blue)]",
        purple: "bg-[var(--brand-purple)]",
        photo: "bg-[var(--primary)]",
      },
    },
    defaultVariants: {
      variant: "coral",
    },
  }
)

function ProductCard({
  className,
  variant = "coral",
  title,
  tagline,
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof productCardVariants> & {
    title?: string
    tagline?: string
  }) {
  return (
    <div
      data-slot="product-card"
      className={cn(productCardVariants({ variant, className }))}
      {...props}
    >
      {title && (
        <h3 className="text-[20px] font-semibold leading-[1.4]">{title}</h3>
      )}
      {tagline && (
        <p className="text-[14px] font-normal opacity-80">{tagline}</p>
      )}
    </div>
  )
}

export { ProductCard, productCardVariants }