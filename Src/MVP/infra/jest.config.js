// Il package dichiarava gia' `"test": "jest"` e portava jest + ts-jest fra le
// devDependencies, ma senza una configurazione lo script non aveva modo di
// trasformare il TypeScript e non e' mai stato eseguibile. Il .gitignore di
// questa cartella lo aveva pero' previsto: ignora `*.js` con l'eccezione
// esplicita `!jest.config.js`, cioe' questo file.
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/test"],
  testMatch: ["**/*.test.ts"],
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.json" }],
  },
};
