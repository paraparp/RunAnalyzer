import { Accordion, AccordionHeader, AccordionBody } from "@tremor/react";

const CollapsibleSection = ({ title, children, defaultOpen = true, className = '' }) => {
    return (
        <div className={`bg-white dark:bg-white/[0.03] rounded-xl border border-slate-200 dark:border-white/10 shadow-sm overflow-hidden ${className}`}>
            <Accordion defaultOpen={defaultOpen} className="border-0 shadow-none bg-transparent ring-0">
                <AccordionHeader className="px-6 py-4 hover:bg-slate-50 dark:hover:bg-white/[0.05] transition-colors">
                    <span className="text-sm font-bold text-slate-800 dark:text-white">
                        {title}
                    </span>
                </AccordionHeader>
                <AccordionBody className="px-6 pb-6 pt-0 leading-normal text-inherit">
                    {children}
                </AccordionBody>
            </Accordion>
        </div>
    );
};

export default CollapsibleSection;
