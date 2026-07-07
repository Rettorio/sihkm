import * as React from "react"

import { cn } from "~/lib/utils"

interface AIProductTileProps extends React.ComponentProps<"div"> {
  icon?: React.ReactNode
  title?: string
  description?: string
}

function AIProductTile({
  className,
  icon,
  title,
  description,
  ...props
}: AIProductTileProps) {
  return (
    <div
      data-slot="ai-product-tile"
      className={cn(
        "bg-canvas rounded-[24px] px-6 py-6 border border-[#e5e7eb]",
        className
      )}
      {...props}
    >
      {icon && (
        <div className="h-[100px] flex items-center justify-center mb-5">
          {icon}
        </div>
      )}
      {title && (
        <h3 className="text-[20px] font-semibold leading-[1.4] text-[#0a0a0a]">
          {title}
        </h3>
      )}
      {description && (
        <p className="text-[14px] font-normal leading-[1.5] text-[#5f5f5f]">
          {description}
        </p>
      )}
    </div>
  )
}

export { AIProductTile }
