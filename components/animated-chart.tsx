"use client"

import { motion, useInView } from "framer-motion"
import { useRef, useState, useEffect } from "react"

interface AnimatedChartProps {
  children: React.ReactNode
  className?: string
}

export function AnimatedChart({ children, className }: AnimatedChartProps) {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: false, amount: 0.3 })
  const [mountKey, setMountKey] = useState(0)

  useEffect(() => {
    if (isInView) {
      setMountKey(prev => prev + 1)
    }
  }, [isInView])

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 30 }}
      animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className={className}
    >
      <div key={mountKey}>
        {children}
      </div>
    </motion.div>
  )
}
