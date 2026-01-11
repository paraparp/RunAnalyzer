import React from 'react';

const Logo = ({ className = '', style = {} }) => (
    <svg
        width="40"
        height="40"
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        style={{ marginRight: '0.75rem', filter: 'drop-shadow(0 0 6px rgba(59, 130, 246, 0.4))', ...style }}
    >
        <defs>
            <linearGradient id="logoGradient" x1="0" y1="0" x2="40" y2="40">
                <stop offset="0%" stopColor="#22d3ee" />   {/* Cyan */}
                <stop offset="50%" stopColor="#3b82f6" />  {/* Blue */}
                <stop offset="100%" stopColor="#8b5cf6" /> {/* Purple */}
            </linearGradient>
        </defs>

        {/* Dynamic Data Bars / Speed Lines representing analysis and motion */}
        <rect x="6" y="20" width="6" height="12" rx="2" transform="skewX(-12)" fill="url(#logoGradient)" opacity="0.7" />
        <rect x="15" y="14" width="6" height="18" rx="2" transform="skewX(-12)" fill="url(#logoGradient)" opacity="0.85" />
        <rect x="24" y="6" width="6" height="26" rx="2" transform="skewX(-12)" fill="url(#logoGradient)" />

        {/* Abstract Pulse/Motion path */}
        <path
            d="M2 32C8 32 14 36 24 30C32 25 36 14 36 14"
            stroke="white"
            strokeWidth="2.5"
            strokeLinecap="round"
            opacity="0.25"
            style={{ mixBlendMode: 'overlay' }}
        />
    </svg>
);

export default Logo;
