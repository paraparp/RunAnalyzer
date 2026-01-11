# 📚 Metodologías de Entrenamiento Científicas Implementadas

Este documento detalla las metodologías y principios científicos contrastados que utiliza el **Entrenador AI** de RunAnalyzer para generar planes de entrenamiento personalizados.

---

## 🎯 Resumen Ejecutivo

El sistema combina las mejores prácticas de entrenadores de élite mundial y fisiólogos deportivos reconocidos para crear planes que:
- **Maximizan resultados** minimizando riesgo de lesión
- **Respetan la fisiología** del corredor individual
- **Se basan en evidencia científica** publicada y validada
- **Periodizar correctamente** según el objetivo y tiempo disponible

---

## 📊 1. PRINCIPIO 80/20 (Stephen Seiler)

### Autor
**Dr. Stephen Seiler** - Profesor de Fisiología del Ejercicio, Universidad de Agder (Noruega)

### Concepto
La investigación de Seiler con atletas de élite de resistencia demostró que el **80% del volumen** debe realizarse en **Zona 2 (aeróbico conversacional)** y solo el **20% en alta intensidad** (Zona 4-5).

### Aplicación en RunAnalyzer
- Distribución objetivo: **75-80% fácil** / **10-15% umbral** / **5-10% VO2max**
- Evita la "zona gris" (Zona 3 - tempo moderado constante)
- Control automático de la distribución en el análisis semanal

### Referencias
- Seiler, S. (2010). "What is best practice for training intensity and duration distribution in endurance athletes?" *International Journal of Sports Physiology and Performance*

---

## ⚡ 2. ENTRENAMIENTO POLARIZADO (Modelo Noruego)

### Autores
**Jakob Ingebrigtsen**, **Karsten Warholm**, **Eivind Tønnessen** (Norwegian Olympic Committee)

### Concepto
Las sesiones deben ser **claramente diferenciadas**: o muy fáciles (Zona 1-2) o muy intensas (Zona 4-5). Se evita el entrenamiento "moderado" continuo que genera fatiga sin los beneficios del trabajo polarizado.

### Aplicación en RunAnalyzer
- Máximo **2-3 sesiones de alta intensidad** por semana
- Recuperación activa **obligatoria** entre sesiones de calidad
- Días de rodaje fácil verdaderamente fáciles (no "tempo camuflado")

### Referencias
- Tønnessen, E. et al. (2014). "The annual training periodization of 8 world champion track and field athletes" *International Journal of Sports Physiology and Performance*

---

## 🏃 3. SISTEMA VDOT (Jack Daniels)

### Autor
**Dr. Jack Daniels** - Legendario entrenador olímpico y fisiólogo

### Concepto
El **VDOT** es un número que representa tu capacidad aeróbica actual basado en tus tiempos de carrera recientes. Define zonas de entrenamiento personalizadas:

- **R (Recovery)**: Más lento que ritmo maratón +90s/km
- **E (Easy)**: Ritmo maratón +60-90s/km, conversacional
- **M (Marathon pace)**: Ritmo objetivo de maratón
- **T (Threshold)**: Ritmo sostenible ~50-60min, aprox. ritmo 10K +15-20s/km
- **I (Interval/VO2max)**: Ritmo 3K-5K, esfuerzo muy alto
- **R (Repetition)**: Ritmo 800m-1500m, velocidad pura

### Aplicación en RunAnalyzer
- Analiza historial de actividades para estimar VDOT actual
- Adapta zonas de entrenamiento a la capacidad real del corredor
- Prescribe ritmos específicos basados en tu nivel actual

### Referencias
- Daniels, J. (2013). *Daniels' Running Formula* (3rd Edition)

---

## 🏔️ 4. MÉTODO LYDIARD (Base Aeróbica)

### Autor
**Arthur Lydiard** - Pionero neozelandés del entrenamiento de resistencia

### Concepto
Construcción de una **base aeróbica sólida** antes de introducir intensidad. Estructura en fases según tiempo hasta competición:

1. **>12 semanas**: Base aeróbica (volumen Zona 2 + pendientes suaves)
2. **8-12 semanas**: Introducción de umbral (Tempo runs)
3. **4-8 semanas**: Trabajo específico de ritmo + intervalos VO2max
4. **<4 semanas**: Afinamiento (reducir volumen, mantener intensidad)

### Aplicación en RunAnalyzer
- Evalúa tiempo hasta objetivo
- Periodizar automáticamente según fase de preparación
- Prioriza volumen cuando hay tiempo, intensidad cuando se acerca la carrera

### Referencias
- Lydiard, A. & Gilmour, G. (2017). *Running with Lydiard*

---

## 🇮🇹 5. TRABAJO ESPECÍFICO (Renato Canova)

### Autor
**Renato Canova** - Entrenador de campeones mundiales y olímpicos africanos

### Concepto
El entrenamiento debe **replicar condiciones de carrera** en sesiones clave:

- **Maratón**: Long runs con "finish" a ritmo objetivo (últimos 30-40% del rodaje)
- **10K/HM**: Bloques largos a ritmo objetivo (ej: 3x3km a ritmo HM con recuperación corta)
- **Simulación mental**: Entrenar en condiciones similares a competición

### Aplicación en RunAnalyzer
- Sesiones de "ritmo específico" en bloques progresivos
- Long runs con finish rápido para preparación de maratón
- Trabajo de umbral en bloques largos para 10K/HM

### Referencias
- Canova, R. (2020). Entrevistas y artículos en *LetsRun.com*

---

## 🧘 6. RECUPERACIÓN Y PREVENCIÓN (Principios Modernos)

### Concepto
La recuperación es **TAN IMPORTANTE** como el entrenamiento:

- **48 horas mínimo** entre sesiones de alta intensidad
- **Descanso activo** > descanso pasivo (movilidad, core, técnica)
- **Señales de sobreentrenamiento**: FC matinal elevada, sueño irregular, irritabilidad

### Aplicación en RunAnalyzer
- Días de recuperación espaciados inteligentemente
- Nunca dos sesiones de calidad consecutivas
- Sugerencias de actividades complementarias (fuerza, movilidad)

---

## 📈 7. PROGRESIÓN CONSERVADORA (Regla del 10%)

### Concepto
Aumentar volumen de forma gradual para evitar lesiones:

- **Máximo 10% de incremento semanal** en kilometraje
- **Semanas de descarga** (60-70% volumen) cada 3-4 semanas
- Escuchar al cuerpo antes que al plan

### Aplicación en RunAnalyzer
- Analiza volumen reciente del historial
- No sugiere incrementos bruscos
- Incluye semanas de descarga automáticas si detecta fatiga acumulada

---

## 🎓 Tipos de Sesiones Implementadas

### 1. **Rodaje Fácil (Easy Run)**
- **Zona**: 2 (60-75% FCmáx)
- **Objetivo**: Base aeróbica, capilarización, adaptaciones mitocondrias
- **Ritmo**: Conversacional, nunca forzar

### 2. **Rodaje Largo (Long Run)**
- **Zona**: 2 mayormente, puede incluir finish a ritmo objetivo
- **Objetivo**: Resistencia, eficiencia energética, preparación mental
- **Duración**: 20-30% del volumen semanal

### 3. **Tempo/Umbral (Threshold)**
- **Zona**: 3-4 (umbral de lactato)
- **Objetivo**: Mejorar clearance de lactato, elevar umbral anaeróbico
- **Estructura**: Bloques 15-40min a ritmo 10K+15-20s

### 4. **Intervalos VO2max**
- **Zona**: 5 (90-95% FCmáx)
- **Objetivo**: Maximizar consumo de oxígeno
- **Estructura**: 3-5min intensos (ritmo 3K-5K) con recuperación igual o mayor

### 5. **Series de Velocidad**
- **Zona**: 5+ (máxima)
- **Objetivo**: Economía de carrera, neuromuscular, explosividad
- **Estructura**: 200m-1K a ritmo muy rápido, recuperación completa

### 6. **Fartlek**
- **Zona**: Variable
- **Objetivo**: Adaptación mental, simulación de carrera, diversión
- **Estructura**: Cambios de ritmo orgánicos según sensaciones

### 7. **Rodaje Recuperación**
- **Zona**: 1 (50-60% FCmáx)
- **Objetivo**: Activar circulación sin generar fatiga
- **Duración**: 20-40min muy muy suave

---

## 🔬 Validación Científica

Todas las metodologías implementadas están respaldadas por:

- ✅ Publicaciones en revistas científicas peer-reviewed
- ✅ Resultados de atletas de élite mundial
- ✅ Décadas de experiencia de entrenadores legendarios
- ✅ Estudios de fisiología del ejercicio en laboratorio

---

## 📚 Bibliografía Recomendada

1. **Daniels, J.** (2013). *Daniels' Running Formula* (3rd Ed.)
2. **Lydiard, A.** (2017). *Running with Lydiard*
3. **Seiler, S.** (2010). "Training Intensity Distribution" - Sports Physiology
4. **Magness, S.** (2014). *The Science of Running*
5. **Fitzgerald, M.** (2017). *80/20 Running*
6. **Pfitzinger, P.** (2015). *Advanced Marathoning* (3rd Ed.)

---

## 🚀 Resultado en RunAnalyzer

Al combinar todas estas metodologías, el **Entrenador AI** crea planes que:

1. ✅ **Respetan tu fisiología** individual
2. ✅ **Maximizan adaptaciones** aeróbicas y anaeróbicas
3. ✅ **Minimizan riesgo** de lesión y sobreentrenamiento
4. ✅ **Periorizan correctamente** según tu objetivo
5. ✅ **Se adaptan a tu nivel** actual (no son genéricos)
6. ✅ **Incluyen recuperación** como parte integral del plan

---

**Última actualización**: Enero 2026  
**Versión**: 2.0 - Implementación con Groq/Gemini AI
