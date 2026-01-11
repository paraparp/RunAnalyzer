import React from 'react';
import { Accordion, AccordionHeader, AccordionBody } from "@tremor/react";

const CollapsibleSection = ({ title, children, defaultOpen = true, className = '' }) => {
    return (
        <div className={className}>
            <Accordion defaultOpen={defaultOpen} className="border-0 shadow-none bg-transparent ring-0">
                <AccordionHeader className="px-0 py-3 border-b border-gray-200 dark:border-gray-800 hover:bg-transparent">
                    <span className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-widest flex items-center gap-2">
                        <span className="w-2 h-2 bg-indigo-500 rounded-full shadow-[0_0_8px_rgba(99,102,241,0.6)]"></span>
                        {title}
                    </span>
                </AccordionHeader>
                <AccordionBody className="px-0 py-4 leading-normal text-inherit">
                    {children}
                </AccordionBody>
            </Accordion>
        </div>
    );
};

export default CollapsibleSection;
