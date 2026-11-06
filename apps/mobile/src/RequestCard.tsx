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
    [busy, setBusy] = useState(false),
    [submitted,setSubmitted] = useState(false),
    [messageId] = useState(()=>'question-'+Date.now()+'-'+Math.random().toString(36).slice(2));
  const submit = async (method: string, params: any) => {
    setBusy(true);
    try {
      await client.rpc(method, { threadId, requestId: r.id, ...params });
      setSubmitted(true);
    } catch (e) {
      const error=(e as Error).message;
      if(/INPUT_REQUEST_EXPIRED|INPUT_ALREADY_SUBMITTED/.test(error)) {
        setSubmitted(true);onError('这个问题已提交或在另一端处理，请刷新聊天。');
      } else onError(error);
    } finally {
      setBusy(false);
    }
  };
  const action = (label: string, fn: () => void, disabled = false) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      disabled={!online || busy || submitted || disabled}
      onPress={fn}
      style={{
        backgroundColor:
          label === '允许' || label === '提交回答' ? c.button : c.soft,
        opacity: !online || busy || submitted || disabled ? 0.4 : 1,
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
  const asyncInput = r.method === 'desktop/asyncQuestion';
  const command = r.method === 'item/commandExecution/requestApproval',
    file = r.method === 'item/fileChange/requestApproval',
    input = r.method === 'item/tool/requestUserInput' || asyncInput;
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
        {input ? '问题 · 等待你的回答' : '电脑请求确认'}
      </Text>
      {submitted && <Text style={{color:c.muted,marginTop:8}}>已提交，正在同步电脑状态…</Text>}
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
              {q.options?.map((o: any) => (
                <Pressable key={o.label} accessibilityRole="radio" accessibilityLabel={o.label}
                  accessibilityState={{checked:answers[q.id]===o.label,disabled:!online||busy||submitted}}
                  disabled={!online||busy||submitted} onPress={()=>setAnswers({...answers,[q.id]:o.label})}
                  style={{padding:12,marginTop:8,borderRadius:12,borderWidth:1,borderColor:answers[q.id]===o.label?c.text:c.line,backgroundColor:c.soft}}>
                  <Text style={{color:c.text,fontWeight:answers[q.id]===o.label?'700':'400'}}>{answers[q.id]===o.label?'◉ ':'○ '}{o.label}</Text>
                  {!!o.description&&<Text style={{color:c.muted,marginTop:4}}>{o.description}</Text>}
                </Pressable>
              ))}
              <TextInput
                accessibilityLabel={q.header ?? q.question}
                placeholder="也可以填写自己的回答"
                placeholderTextColor={c.muted}
                editable={online && !busy && !submitted}
                secureTextEntry={q.isSecret === true}
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
              asyncInput ? submit('async-input/respond', {answer: answers[r.params.questions[0].id], messageId}) : submit('input/respond', {
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
