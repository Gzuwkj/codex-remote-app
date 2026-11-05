import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { client } from './client';
import { palette } from './ui';
export function RequestCard({
  request: r,
  threadId,
  online,
  onError,
  dark = false,
}: {
  request: any;
  threadId: string;
  online: boolean;
  onError: (s: string) => void;
  dark?: boolean;
}) {
  const c = palette(dark);
  const [answers, setAnswers] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false);
  const submit = async (method: string, params: any) => {
    setBusy(true);
    try {
      await client.rpc(method, { threadId, requestId: r.id, ...params });
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const action = (label: string, fn: () => void, disabled = false) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      disabled={!online || busy || disabled}
      onPress={fn}
      style={{
        backgroundColor:
          label === '允许' || label === '提交回答' ? c.button : c.soft,
        opacity: !online || busy || disabled ? 0.4 : 1,
        padding: 12,
        borderRadius: 12,
        marginTop: 8,
      }}
    >
      <Text
        style={{
          color:
            label === '允许' || label === '提交回答' ? c.buttonText : c.text,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
  const command = r.method === 'item/commandExecution/requestApproval',
    file = r.method === 'item/fileChange/requestApproval',
    input = r.method === 'item/tool/requestUserInput';
  return (
    <View
      style={{
        padding: 16,
        margin: 0,
        borderRadius: 16,
        backgroundColor: c.surface,
      }}
    >
      <Text style={{ fontWeight: '700', fontSize: 17, color: c.text }}>
        电脑请求确认
      </Text>
      {command || file ? (
        <>
          <Text selectable style={{ color: c.text }}>
            {r.params?.reason ?? r.params?.command ?? r.method}
          </Text>
          {action('允许', () =>
            submit('approval/respond', {
              kind: file ? 'file' : 'command',
              decision: 'accept',
            }),
          )}
          {action('拒绝', () =>
            submit('approval/respond', {
              kind: file ? 'file' : 'command',
              decision: 'decline',
            }),
          )}
        </>
      ) : input ? (
        <>
          {(r.params?.questions ?? []).map((q: any) => (
            <View key={q.id}>
              <Text style={{ color: c.text, marginTop: 10 }}>{q.question}</Text>
              {q.options?.map((o: any) =>
                action(o.label, () =>
                  setAnswers({ ...answers, [q.id]: o.label }),
                ),
              )}
              <TextInput
                accessibilityLabel={q.header ?? q.question}
                value={answers[q.id] ?? ''}
                onChangeText={text => setAnswers({ ...answers, [q.id]: text })}
                style={{
                  borderWidth: 1,
                  borderColor: c.line,
                  padding: 10,
                  marginTop: 8,
                  color: c.text,
                }}
              />
            </View>
          ))}
          {action(
            '提交回答',
            () =>
              submit('input/respond', {
                response: {
                  answers: Object.fromEntries(
                    Object.entries(answers).map(([id, text]) => [
                      id,
                      { answers: [text] },
                    ]),
                  ),
                },
              }),
            (r.params?.questions ?? []).some(
              (q: any) => !answers[q.id]?.trim(),
            ),
          )}
        </>
      ) : (
        <Text style={{ color: c.text, marginTop: 8 }}>
          此请求类型仍在适配，请在电脑处理：{r.method}
        </Text>
      )}
    </View>
  );
}
