module.exports = {
  preset: '@react-native/jest-preset',
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation|@reduxjs/toolkit|immer|react-redux|redux|react-native-keychain|react-native-safe-area-context|react-native-screens|react-native-toast-message)/)',
  ],
};
