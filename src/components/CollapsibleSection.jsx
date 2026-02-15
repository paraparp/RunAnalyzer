import { Accordion, AccordionHeader, AccordionBody } from "@tremor/react";

const CollapsibleSection = ({ title, children, defaultOpen = true, className = '' }) => {
    return (
        <div className={`bg-white rounded-xl border border-slate-200/80 overflow-hidden ${className}`}>
            <Accordion defaultOpen={defaultOpen} className="border-0 shadow-none bg-transparent ring-0">
                <AccordionHeader className="px-6 py-4 hover:bg-slate-50/50 transition-colors">
                    <span className="text-[13px] font-bold text-slate-700 uppercase tracking-wider">
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
