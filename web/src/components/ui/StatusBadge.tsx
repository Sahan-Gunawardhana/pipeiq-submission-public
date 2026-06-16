'use client';

import clsx from 'clsx';
import { motion } from 'framer-motion';

interface StatusBadgeProps {
    status: string;
    className?: string;
}

export default function StatusBadge({ status, className }: StatusBadgeProps) {
    let colorClass = 'bg-gray-100 text-gray-700 border-gray-200';
    let dotClass = 'bg-gray-500';
    let pulse = false;

    const lowerStatus = status.toLowerCase();

    if (['active', 'good', 'operational', 'normal'].includes(lowerStatus)) {
        // Monochrome: Solid Black/Dark Gray for "Good"
        colorClass = 'bg-neutral-100 text-neutral-900 border-neutral-200';
        dotClass = 'bg-neutral-900';
        pulse = true;
    } else if (['maintenance', 'fair', 'warning'].includes(lowerStatus)) {
        // Monochrome: Medium Gray/Striped look implication
        colorClass = 'bg-neutral-50 text-neutral-600 border-neutral-200 border-dashed';
        dotClass = 'bg-neutral-400';
    } else if (['inactive', 'poor', 'critical', 'high'].includes(lowerStatus)) {
        // Monochrome: Outlined Black for "Critical"
        colorClass = 'bg-white text-black border-black';
        dotClass = 'bg-black';
        pulse = true;
    }

    return (
        <div className={clsx(
            "inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-medium border",
            colorClass,
            className
        )}>
            <div className="relative flex items-center justify-center">
                <div className={clsx("w-1.5 h-1.5 rounded-full", dotClass)} />
                {pulse && (
                    <motion.div
                        initial={{ opacity: 0.5, scale: 1 }}
                        animate={{ opacity: 0, scale: 2 }}
                        transition={{ duration: 1.5, repeat: Infinity, ease: "easeOut" }}
                        className={clsx("absolute w-1.5 h-1.5 rounded-full", dotClass)}
                    />
                )}
            </div>
            {status}
        </div>
    );
}
