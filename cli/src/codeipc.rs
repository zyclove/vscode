/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

#[allow(dead_code)]
mod packets {
	use std::{io, pin::Pin};

	use async_recursion::async_recursion;
	use serde::Serialize;
	use tokio::{
		io::{AsyncReadExt, AsyncWriteExt},
		pin,
	};

	const DELIM_UNDEFINED: u8 = 0;
	const DELIM_STRING: u8 = 1;
	const DELIM_BUFFER: u8 = 2;
	const DELIM_VSBUFFER: u8 = 3;
	const DELIM_ARRAY: u8 = 4;
	const DELIM_OBJECT: u8 = 5;
	const DELIM_INT: u8 = 6;
	const MAX_DELIM: u8 = DELIM_INT;

	mod vql {
		use std::io;

		use tokio::{
			io::{AsyncReadExt, AsyncWriteExt},
			pin,
		};

		const MAX_LENGTH: usize = 6;

		/// Encodes a variable-length quantity into a byte array. Must have length >= 5
		pub async fn write_vql(value: i32, writer: impl tokio::io::AsyncWrite) -> io::Result<()> {
			pin!(writer);

			let mut buf: [u8; MAX_LENGTH] = [0; MAX_LENGTH];
			if value == 0 {
				return writer.write_all(&buf[..1]).await;
			}

			// re-declare as u32 so the right shift is logical, not arithmetic
			let mut value = {
				let bytes = value.to_be_bytes();
				u32::from_be_bytes(bytes)
			};

			let mut size = 0;
			while value != 0 {
				buf[size] = (value & 0b01111111) as u8;
				value >>= 7;
				if value > 0 {
					buf[size] |= 0b10000000;
				}

				size += 1;
			}

			writer.write_all(&buf[..size]).await
		}
		/// Encodes a variable-length quantity into a byte array. Must have length >= 5
		pub async fn read_vql(reader: impl tokio::io::AsyncRead) -> io::Result<i32> {
			pin!(reader);

			let mut value = 0;
			let mut buf: [u8; 1] = [0; 1];
			for n in (0..).step_by(7) {
				match reader.read(&mut buf).await {
					Ok(0) => {
						return Err(io::Error::new(
							io::ErrorKind::UnexpectedEof,
							"unexpected EOF reading varint",
						))
					}
					Ok(1) => {
						value |= ((buf[0] & 0b01111111) as i32) << n;
						if (buf[0] & 0b10000000) == 0 {
							return Ok(value);
						}
					}
					Err(e) => return Err(e),
					_ => unreachable!(),
				}
			}

			unreachable!();
		}

		mod tests {
			use super::*;
			use std::io::Cursor;

			#[tokio::test]
			async fn test_vql() {
				for input in vec![0, 1, -1, 1234, -1234, i32::MAX, i32::MIN] {
					let mut rw = Cursor::new(Vec::new());
					write_vql(input, &mut rw).await.unwrap();
					rw.set_position(0);
					assert_eq!(read_vql(&mut rw).await.unwrap(), input);
				}
			}
		}
	}

	#[derive(Debug, PartialEq, Eq)]
	pub enum CodePacket {
		Undefined,
		/// A utf-8 string.
		String(String),
		/// A buffer of raw binary data
		Buffer(Vec<u8>),
		/// A buffer that's encoded/decoded as a VSBuffer.
		VSBuffer(Vec<u8>),
		/// Array of nested code packet data.
		Array(Vec<CodePacket>),
		/// Object data, containing JSON data in a vector.
		Object(Vec<u8>),
		/// A 32-bit integer
		Int32(i32),
	}

	impl CodePacket {
		/// Creates a CodePacket::Undefined
		pub fn undefined() -> Self {
			CodePacket::Undefined
		}

		/// Creates a CodePacket::VSBuffer
		pub fn from_string(str: String) -> Self {
			CodePacket::String(str)
		}

		/// Creates a CodePacket::VSBuffer
		pub fn from_vs_buffer(arr: Vec<u8>) -> Self {
			CodePacket::VSBuffer(arr)
		}

		/// Creates a CodePacket::Buffer
		pub fn from_buffer(arr: Vec<u8>) -> Self {
			CodePacket::Buffer(arr)
		}

		/// Creates a CodePacket from an array of nested packets
		pub fn from_array(arr: Vec<CodePacket>) -> Self {
			CodePacket::Array(arr)
		}

		/// Creates a CodePacket from a JSON object
		pub fn from_object<T>(obj: &T) -> Result<Self, serde_json::Error>
		where
			T: ?Sized + Serialize,
		{
			Ok(CodePacket::Object(serde_json::to_vec(obj)?))
		}

		/// Reads a single data packet from the reader. It's recommended to use
		/// a BufReader when calling this method.
		pub async fn from_reader<T>(reader: &mut T) -> io::Result<Self>
		where
			T: tokio::io::AsyncRead + Unpin,
		{
			pin!(reader);

			// an iterative approach is used for parsing arrays, since there are
			// constraints with recursive async functions in rust
			let mut nested_reads = vec![(0, Vec::with_capacity(1))];
			loop {
				let mut typ = [0; 1];
				reader.read_exact(&mut typ).await?;
				let typ = typ[0];

				let next_packet = if typ == DELIM_UNDEFINED {
					Self::Undefined
				} else if typ == DELIM_INT {
					let v = vql::read_vql(&mut reader).await?;
					Self::Int32(v)
				} else if typ > MAX_DELIM {
					return Err(io::Error::new(
						io::ErrorKind::InvalidData,
						format!("unexpected packet type {}", typ),
					));
				} else {
					let len = vql::read_vql(&mut reader).await? as usize;
					if typ == DELIM_ARRAY {
						Self::Array(Vec::with_capacity(len))
					} else {
						let mut data = vec![0; len];
						reader.read_exact(&mut data).await?;
						match typ {
							DELIM_STRING => Self::String(String::from_utf8(data).map_err(|e| {
								io::Error::new(
									io::ErrorKind::InvalidData,
									format!("invalid utf-8 in string: {}", e),
								)
							})?),
							DELIM_BUFFER => Self::Buffer(data),
							DELIM_VSBUFFER => Self::VSBuffer(data),
							DELIM_OBJECT => Self::Object(data),
							_ => unreachable!(),
						}
					}
				};

				if let Self::Array(a) = next_packet {
					nested_reads.push((nested_reads.last().unwrap().1.len(), a));
				} else {
					nested_reads.last_mut().unwrap().1.push(next_packet);
					let last = nested_reads.last().unwrap();
					if last.1.capacity() == last.1.len() {
						let (i, mut arr) = nested_reads.pop().unwrap();
						if nested_reads.len() == 0 {
							return Ok(arr.remove(0));
						} else {
							nested_reads
								.last_mut()
								.unwrap()
								.1
								.insert(i, Self::Array(arr));
						}
					}
				}
			}
		}

		/// Encodes the CodePacket to the given writer. It's recommended to use a
		/// BufWriter when calling this method.
		#[async_recursion]
		pub async fn to_writer(&self, writer: impl tokio::io::AsyncWrite + Send) -> io::Result<()> {
			pin!(writer);
			match self {
				CodePacket::Undefined => writer.write_all(&[DELIM_UNDEFINED]).await,
				CodePacket::String(s) => {
					writer
						.write_all(&make_sized_header(DELIM_STRING, s.len()))
						.await?;
					writer.write_all(s.as_bytes()).await
				}
				CodePacket::Buffer(b) => {
					writer
						.write_all(&make_sized_header(DELIM_BUFFER, b.len()))
						.await?;
					writer.write_all(&b).await
				}
				CodePacket::VSBuffer(b) => {
					writer
						.write_all(&make_sized_header(DELIM_VSBUFFER, b.len()))
						.await?;
					writer.write_all(&b).await
				}
				CodePacket::Array(p) => {
					writer
						.write_all(&make_sized_header(DELIM_ARRAY, p.len()))
						.await?;
					for cp in p {
						cp.to_writer(&mut writer).await?;
					}
					Ok(())
				}
				CodePacket::Object(b) => {
					writer
						.write_all(&make_sized_header(DELIM_OBJECT, b.len()))
						.await?;
					writer.write_all(&b).await
				}
				CodePacket::Int32(i) => {
					writer.write_all(&[DELIM_INT]).await?;
					vql::write_vql(*i, &mut writer).await
				}
			}
		}

		/// Returns a JSON representation of the CodePacket. Buffers are encoded
		/// using numerical arrays.
		pub fn to_json(&self) -> Vec<u8> {
			match self {
				CodePacket::Undefined => "undefined".as_bytes().to_owned(),
				CodePacket::String(s) => serde_json::to_vec(s).expect("illegal non-utf-8 data"),
				// buffer and vsbuffer should never fail:
				CodePacket::Buffer(b) => serde_json::to_vec(b).unwrap(),
				CodePacket::VSBuffer(b) => serde_json::to_vec(b).unwrap(),
				CodePacket::Array(p) => {
					let mut buf = vec!['[' as u8];
					for i in 0..p.len() {
						if i > 0 {
							buf.push(',' as u8);
						}

						buf.append(&mut p[i].to_json())
					}
					buf.push(']' as u8);
					buf
				}
				CodePacket::Object(b) => b.to_owned(),
				CodePacket::Int32(i) => serde_json::to_vec(i).unwrap(),
			}
		}

		pub fn to_i32(&self) -> Result<i32, io::Error> {
			if let CodePacket::Int32(i) = self {
				return Ok(*i);
			}

			self.to_object::<i32>()
		}

		/// Deserializes the contents of the object packet, if any.
		pub fn to_object<T>(&self) -> Result<T, io::Error>
		where
			T: serde::de::DeserializeOwned,
		{
			let r = match self {
				CodePacket::Undefined => serde_json::from_slice(b"null"),
				CodePacket::Object(v) => serde_json::from_slice(v),
				_ => {
					return Err(io::Error::new(
						io::ErrorKind::InvalidData,
						format!("expect an object packet, got {:?}", self),
					))
				}
			};

			r.map_err(|e| {
				io::Error::new(
					io::ErrorKind::InvalidData,
					format!("failed to parse json: {}", e),
				)
			})
		}
	}

	fn make_sized_header(type_marker: u8, size: usize) -> [u8; 5] {
		let l = (size as u32).to_be_bytes();
		[type_marker, l[0], l[1], l[2], l[3]]
	}
}

mod requests {
	use serde::{Deserialize, Serialize};

	use super::packets::CodePacket;
	use std::{fmt::Debug, io};

	const REQUEST_PROMISE: u8 = 100;
	const REQUEST_PROMISE_CANCEL: u8 = 101;
	const REQUEST_EVENT_LISTEN: u8 = 102;
	const REQUEST_EVENT_DISPOSE: u8 = 103;

	const RESPONSE_INITIALIZE: u8 = 200;
	const RESPONSE_PROMISE_SUCCESS: u8 = 201;
	const RESPONSE_PROMISE_ERROR: u8 = 202;
	const RESPONSE_PROMISE_ERROR_OBJ: u8 = 203;
	const RESPONSE_EVENT_FIRE: u8 = 204;

	#[derive(Debug, PartialEq, Eq)]
	pub enum Message {
		RequestPromise {
			id: i32,
			channel_name: String,
			name: String,
			arg: CodePacket,
		},
		RequestPromiseCancel {
			id: i32,
		},
		RequestEventListen {
			id: i32,
			channel_name: String,
			name: String,
			arg: CodePacket,
		},
		RequestEventDispose {
			id: i32,
		},

		ResponseInitialize,
		ResponsePromiseSuccess {
			id: i32,
		},
		ResponsePromiseError {
			id: i32,
			data: PromiseErrorData,
		},
		ResponsePromiseErrorObject {
			id: i32,
			data: CodePacket,
		},
		ResponseEventFired {
			id: i32,
			data: CodePacket,
		},
	}

	#[derive(Deserialize, Serialize, Debug, PartialEq, Eq)]
	pub struct PromiseErrorData {
		pub message: String,
		pub name: String,
		pub stack: Option<Vec<String>>,
	}

	fn invalid<T>(msg: &'static str, actual: impl Debug) -> io::Result<T> {
		Err(io::Error::new(
			io::ErrorKind::InvalidData,
			format!("invalid packet, {}. Got: {:?}", msg, actual),
		))
	}

	pub async fn read_message(
		mut reader: impl tokio::io::AsyncRead + Unpin,
	) -> Result<Message, io::Error> {
		let header = CodePacket::from_reader(&mut reader).await?;
		let header = match header {
			CodePacket::Array(parts) => parts,
			a => return invalid("expected header to be array", a),
		};

		// todo: integers are encoded as strings, but varints would be more efficient
		let typ = match header.get(0) {
			Some(p) => p.to_i32()?,
			a => return invalid("expected packet type", a),
		};

		let m = match typ as u8 {
			REQUEST_PROMISE => Message::RequestPromise {
				id: match header.get(1) {
					Some(CodePacket::Int32(e)) => *e,
					u => return invalid("expected request id", u),
				},
				channel_name: match header.get(2) {
					Some(CodePacket::String(s)) => s.clone(),
					u => return invalid("expected channel name", u),
				},
				name: match header.get(3) {
					Some(CodePacket::String(s)) => s.clone(),
					u => return invalid("expected request name", u),
				},
				arg: match CodePacket::from_reader(&mut reader).await {
					Ok(o) => o,
					u => return invalid("expected promise body", u),
				},
			},
			REQUEST_EVENT_LISTEN => Message::RequestEventListen {
				id: match header.get(1) {
					Some(CodePacket::Int32(e)) => *e,
					u => return invalid("expected request id", u),
				},
				channel_name: match header.get(2) {
					Some(CodePacket::String(s)) => s.clone(),
					u => return invalid("expected channel name", u),
				},
				name: match header.get(3) {
					Some(CodePacket::String(s)) => s.clone(),
					u => return invalid("expected request name", u),
				},
				arg: match CodePacket::from_reader(&mut reader).await {
					Ok(o) => o,
					u => return invalid("expected promise body", u),
				},
			},
			REQUEST_PROMISE_CANCEL => Message::RequestPromiseCancel {
				id: match header.get(1) {
					Some(CodePacket::Int32(e)) => *e,
					u => return invalid("expected request id", u),
				},
			},
			REQUEST_EVENT_DISPOSE => Message::RequestEventDispose {
				id: match header.get(1) {
					Some(CodePacket::Int32(e)) => *e,
					u => return invalid("expected request id", u),
				},
			},
			RESPONSE_INITIALIZE => Message::ResponseInitialize,
			RESPONSE_PROMISE_SUCCESS => Message::ResponsePromiseSuccess {
				id: match header.get(1) {
					Some(CodePacket::Int32(e)) => *e,
					u => return invalid("expected request id", u),
				},
			},
			RESPONSE_PROMISE_ERROR => Message::ResponsePromiseError {
				id: match header.get(1) {
					Some(CodePacket::Int32(e)) => *e,
					u => return invalid("expected request id", u),
				},
				data: match CodePacket::from_reader(&mut reader).await {
					Ok(o) => o.to_object()?,
					u => return invalid("expected promise body", u),
				},
			},
			RESPONSE_PROMISE_ERROR_OBJ => Message::ResponsePromiseErrorObject {
				id: match header.get(1) {
					Some(CodePacket::Int32(e)) => *e,
					u => return invalid("expected request id", u),
				},
				data: match CodePacket::from_reader(&mut reader).await {
					Ok(o) => o,
					u => return invalid("expected promise body", u),
				},
			},
			RESPONSE_EVENT_FIRE => Message::ResponseEventFired {
				id: match header.get(1) {
					Some(CodePacket::Int32(e)) => *e,
					u => return invalid("expected request id", u),
				},
				data: match CodePacket::from_reader(&mut reader).await {
					Ok(o) => o,
					u => return invalid("expected promise body", u),
				},
			},
			t => {
				return Err(io::Error::new(
					io::ErrorKind::InvalidData,
					format!("unknown packet type {}", t),
				))
			}
		};

		Ok(m)
	}

	mod tests {

		use std::io::Cursor;

		use super::*;

		#[tokio::test]
		async fn test_parses_request() {
			let input = vec![
				4, 4, 6, 100, 6, 0, 1, 11, 116, 101, 115, 116, 99, 104, 97, 110, 110, 101, 108, 1,
				5, 109, 97, 114, 99, 111, 0,
			];

			let actual = read_message(Cursor::new(input)).await.unwrap();

			assert_eq!(
				actual,
				Message::RequestPromise {
					id: 0,
					channel_name: "testchannel".to_string(),
					name: "marco".to_string(),
					arg: CodePacket::Undefined,
				}
			);
		}
	}
}

mod rpc {
	use super::requests;
	use std::{
		collections::HashMap,
		sync::atomic::{AtomicI32, Ordering},
	};

	use async_trait::async_trait;
	use serde::Serialize;
	use tokio::{
		io::{AsyncRead, AsyncWrite, BufReader, BufStream, BufWriter},
		sync::oneshot,
	};

	use super::packets::CodePacket;

	static INSTANCE_COUNTER: AtomicI32 = AtomicI32::new(0);
	pub fn next_counter() -> i32 {
		INSTANCE_COUNTER.fetch_add(1, Ordering::SeqCst)
	}

	struct ChannelClient {}

	struct ChannelServerBuilder {
		channels: HashMap<String, Box<dyn ChannelServerImpl>>,
		pending: HashMap<i32, oneshot::Sender<CodePacket>>,
	}

	impl ChannelServerBuilder {
		pub fn new() -> Self {
			Self {
				channels: HashMap::new(),
				pending: HashMap::new(),
			}
		}

		pub fn register_channel(
			&mut self,
			name: &str,
			channel: impl ChannelServerImpl + Sized + 'static,
		) {
			self.channels.insert(name.to_string(), Box::new(channel));
		}

		pub async fn serve(self, reader: impl AsyncRead + Unpin, writer: impl AsyncWrite) {
			let mut reader = BufReader::new(reader);
			let mut writer = BufWriter::new(writer);

			loop {
				let msg = requests::read_message(&mut reader).await.unwrap();
			}
		}
	}

	#[async_trait]
	pub trait ChannelServerImpl {
		fn handle_call(&self, method: String, arg: CodePacket) -> CodePacket;
	}
}
