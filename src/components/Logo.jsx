import logoImage from '../assets/logo.png';

const Logo = ({ className = "w-10 h-10", style = {} }) => (
    <img
        src={logoImage}
        alt="RunAnalyzer Logo"
        className={`${className} object-contain bg-white dark:bg-white/[0.03]`}
        style={style}
    />
);

export default Logo;
