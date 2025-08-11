/**
 * Puch AI Safe Mode
 * Sanitizes responses to avoid triggering content filters
 */

function sanitizeForPuchAI(text) {
  if (!text) return text;
  
  // Words that might trigger content filters
  const problematicWords = [
    'death', 'die', 'dying', 'dead', 'murder', 'kill', 'funeral',
    'poison', 'toxic', 'pathetic', 'destroying', 'bomb',
    'cancer', 'tumor', 'disease', 'sick',
    'brutal', 'harsh', 'damage', 'wreck',
    'hospital', 'medical bills', 'killer', 'destroyed',
    'toxin', 'obesity', 'diabetes', 'liver failure',
    'heart attack', 'stroke', 'silent killer',
    'carcinogen', 'carcinogenic', 'lethal', 'fatal',
    'dangerous', 'deadly', 'harmful', 'hazardous',
    'contamination', 'contaminated', 'infected',
    'emergency', 'crisis', 'severe', 'extreme'
  ];
  
  // Replacements for problematic words
  const replacements = {
    'death': 'health risk',
    'die': 'health decline',
    'dying': 'declining',
    'dead': 'unhealthy',
    'murder': 'harm',
    'kill': 'affect',
    'funeral': 'health consequences',
    'poison': 'unhealthy substance',
    'toxic': 'harmful',
    'pathetic': 'concerning',
    'destroying': 'affecting',
    'bomb': 'concern',
    'cancer': 'serious health risk',
    'tumor': 'health complication',
    'disease': 'health condition',
    'sick': 'unwell',
    'brutal': 'honest',
    'harsh': 'direct',
    'damage': 'affect',
    'wreck': 'impact',
    'hospital': 'medical',
    'medical bills': 'healthcare costs',
    'killer': 'risk factor',
    'destroyed': 'affected',
    'toxin': 'harmful substance',
    'obesity': 'weight gain',
    'diabetes': 'blood sugar issues',
    'liver failure': 'liver problems',
    'heart attack': 'heart problems',
    'stroke': 'circulation issues',
    'silent killer': 'hidden risk',
    'carcinogen': 'concerning substance',
    'carcinogenic': 'concerning',
    'lethal': 'very unhealthy',
    'fatal': 'very serious',
    'dangerous': 'concerning',
    'deadly': 'very concerning',
    'harmful': 'concerning',
    'hazardous': 'concerning',
    'contamination': 'quality issue',
    'contaminated': 'quality concern',
    'infected': 'quality issue',
    'emergency': 'important',
    'crisis': 'concern',
    'severe': 'significant',
    'extreme': 'high',
    '4-MEI': 'concerning compound',
    'lead': 'heavy metal',
    'arsenic': 'concerning element',
    'mercury': 'concerning element'
  };
  
  let sanitized = text;
  
  // Replace problematic words
  for (const [word, replacement] of Object.entries(replacements)) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    sanitized = sanitized.replace(regex, replacement);
  }
  
  // Remove excessive capitalization
  sanitized = sanitized.replace(/([A-Z]{3,})/g, (match) => {
    return match.charAt(0) + match.slice(1).toLowerCase();
  });
  
  // Remove multiple exclamation marks
  sanitized = sanitized.replace(/!{2,}/g, '!');
  
  // Remove aggressive punctuation patterns
  sanitized = sanitized.replace(/\?{2,}/g, '?');
  
  // Remove scary medical terminology
  sanitized = sanitized.replace(/fatty liver disease/gi, 'liver health concerns');
  sanitized = sanitized.replace(/irreversible/gi, 'long-term');
  sanitized = sanitized.replace(/painful/gi, 'difficult');
  sanitized = sanitized.replace(/devastating/gi, 'serious');
  sanitized = sanitized.replace(/ticking time bomb/gi, 'growing concern');
  
  // Remove skull emojis and replace with warning symbols
  sanitized = sanitized.replace(/💀/g, '⚠️');
  sanitized = sanitized.replace(/☠️/g, '⚠️');
  
  // Remove "YOUR" in all caps
  sanitized = sanitized.replace(/YOUR/g, 'your');
  
  // Soften the overall tone
  sanitized = sanitized.replace(/BRUTAL TRUTH/gi, 'Health Analysis');
  sanitized = sanitized.replace(/SERIOUS HEALTH WARNING/gi, 'Important Health Information');
  sanitized = sanitized.replace(/HARMFUL INGREDIENTS FOUND/gi, 'Ingredients to Watch');
  sanitized = sanitized.replace(/STOP POISONING YOURSELF/gi, 'Consider Healthier Options');
  sanitized = sanitized.replace(/WARNING/gi, 'Note');
  sanitized = sanitized.replace(/DANGER/gi, 'Caution');
  sanitized = sanitized.replace(/ALERT/gi, 'Notice');
  sanitized = sanitized.replace(/CRITICAL/gi, 'Important');
  sanitized = sanitized.replace(/⚠️{2,}/g, '⚠️');
  sanitized = sanitized.replace(/❌{2,}/g, '❌');
  sanitized = sanitized.replace(/🚨{2,}/g, '🚨');
  
  // Remove any remaining aggressive language patterns
  sanitized = sanitized.replace(/\b(terrible|awful|horrible|disgusting|nasty|vile)\b/gi, 'poor');
  sanitized = sanitized.replace(/\b(destroying|ruining|wrecking|damaging)\b/gi, 'affecting');
  sanitized = sanitized.replace(/\b(immediately|urgently|now)\b/gi, 'soon');
  
  // Soften medical terminology further
  sanitized = sanitized.replace(/neurological damage/gi, 'nervous system concerns');
  sanitized = sanitized.replace(/liver damage/gi, 'liver concerns');
  sanitized = sanitized.replace(/kidney damage/gi, 'kidney concerns');
  sanitized = sanitized.replace(/brain damage/gi, 'cognitive concerns');
  sanitized = sanitized.replace(/organ failure/gi, 'organ stress');
  sanitized = sanitized.replace(/permanent damage/gi, 'long-term effects');
  
  // Remove any direct health scare tactics
  sanitized = sanitized.replace(/you will (get|develop|suffer)/gi, 'may increase risk of');
  sanitized = sanitized.replace(/causes? (cancer|disease|death)/gi, 'linked to health concerns');
  sanitized = sanitized.replace(/proven to cause/gi, 'associated with');
  sanitized = sanitized.replace(/directly causes/gi, 'may contribute to');
  
  return sanitized;
}

function isPuchAISafeMode() {
  // Check if we should use safe mode based on environment variable
  return process.env.PUCH_AI_SAFE_MODE === 'true';
}

module.exports = {
  sanitizeForPuchAI,
  isPuchAISafeMode
};