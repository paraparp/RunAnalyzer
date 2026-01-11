import React from 'react';
import { Accordion, AccordionHeader, AccordionBody, Card } from "@tremor/react";

const CollapsibleSection = ({ title, children, defaultOpen = true, className = '' }) => {
    return (
        <Card className={`p-0 ring-1 ring-black/5 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] bg-white overflow-hidden ${className}`}>
            <Accordion defaultOpen={defaultOpen} className="border-0 shadow-none bg-transparent ring-0">
                <AccordionHeader className="px-6 py-4 border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <span className="text-base font-bold text-slate-800 uppercase tracking-wide flex items-center gap-3">
                        <span className="flex items-center justify-center w-6 h-6 bg-indigo-50 rounded-full text-indigo-500">
                            <span className="w-2 h-2 bg-indigo-500 rounded-full shadow-[0_0_8px_rgba(99,102,241,0.6)]"></span>
                        </span>
                        {title}
                    </span>
                </AccordionHeader>
                <AccordionBody className="px-6 py-6 leading-normal text-inherit">
                    {children}
                </AccordionBody>
            </Accordion>
        </Card>
    );
};

export default CollapsibleSection;
