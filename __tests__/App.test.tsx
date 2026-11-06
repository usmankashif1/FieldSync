/**
 * @format
 */

import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';

jest.mock('../src/core/services/queueEngine', () => ({
  QueueSchedulingError: class QueueSchedulingError extends Error {},
  clearLocalQueue: jest.fn(() => Promise.resolve()),
  getLocalQueue: jest.fn(() => Promise.resolve([])),
  initQueueNetworkListener: jest.fn(() => jest.fn()),
  initializeQueue: jest.fn(() => Promise.resolve()),
  processQueue: jest.fn(() => Promise.resolve()),
  retryReport: jest.fn(() => Promise.resolve()),
  saveReportToQueue: jest.fn(() => Promise.resolve()),
  subscribeToQueue: jest.fn(() => jest.fn()),
}));
jest.mock('../src/screens/home/home.api', () => ({
  fetchHomeItems: jest.fn(() => Promise.resolve([])),
}));
jest.mock('@react-native-community/netinfo', () => ({
  useNetInfo: jest.fn(() => ({ isConnected: true, isInternetReachable: true })),
}));

import App from '../App';
import { processQueue } from '../src/core/services/queueEngine';

test('renders correctly', async () => {
  await ReactTestRenderer.act(() => {
    ReactTestRenderer.create(<App />);
  });
});

test('reconciles the saved queue when the app returns to the foreground', async () => {
  let onAppStateChange: ((state: AppStateStatus) => void) | undefined;
  const listenerSpy = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, listener) => {
      onAppStateChange = listener;
      return { remove: jest.fn() };
    });

  await ReactTestRenderer.act(() => {
    ReactTestRenderer.create(<App />);
  });
  await ReactTestRenderer.act(async () => {
    onAppStateChange?.('active');
  });

  expect(processQueue).toHaveBeenCalledTimes(1);
  listenerSpy.mockRestore();
});
