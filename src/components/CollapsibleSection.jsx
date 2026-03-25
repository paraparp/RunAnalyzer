import { Accordion, AccordionHeader, AccordionBody } from "@tremor/react";

const CollapsibleSection = ({ title, children, defaultOpen = true, className = '' }) => {
    return (
        <div className={`bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden ${className}`}>
            <Accordion defaultOpen={defaultOpen} className="border-0 shadow-none bg-transparent ring-0">
                <AccordionHeader className="px-8 py-6 hover:bg-surface-container-low transition-colors">
                    <span className="text-xl font-bold text-on-surface">
                        {title}
                    </span>
                </AccordionHeader>
                <AccordionBody className="px-8 pb-8 pt-0 leading-normal text-inherit">
                    {children}
                </AccordionBody>
            </Accordion>
        </div>
    );
};

export default CollapsibleSection;
