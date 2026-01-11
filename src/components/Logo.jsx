import React from 'react';
import logoImage from '../assets/logo.png';

const Logo = ({ className = "w-10 h-10", style = {} }) => (
    <img
        src={logoImage}
        alt="RunAnalyzer Logo"
        className={`${className} object-contain`}
        style={style}
    />
);

export default Logo;
