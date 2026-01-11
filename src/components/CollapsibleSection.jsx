import React, { useState } from 'react';

const CollapsibleSection = ({ title, children, defaultOpen = true, className = '' }) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
        <div className={`collapsible-section ${className}`} style={{ marginBottom: '0px' }}>
            <div
                onClick={() => setIsOpen(!isOpen)}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    userSelect: 'none',
                    padding: '0.4rem 0',
                    borderBottom: '1px solid var(--border-color)',
                    background: 'transparent'
                }}
            >
                <h3 className="section-title" style={{ margin: 0, padding: 0 }}>
                    {title}
                </h3>
                <span style={{
                    transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                    transition: 'transform 0.3s ease',
                    color: 'var(--text-secondary)',
                    fontSize: '0.9rem',
                    opacity: 0.7
                }}>
                    ▼
                </span>
            </div>

            {isOpen && (
                <div style={{ padding: '0.5rem 0 1rem 0', animation: 'fadeIn 0.3s ease-out' }}>
                    {children}
                </div>
            )}
        </div>
    );
};

export default CollapsibleSection;
