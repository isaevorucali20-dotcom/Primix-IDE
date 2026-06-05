import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, signInWithPopup, GoogleAuthProvider, signOut, User } from "firebase/auth";
import { 
  getFirestore, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  collection, 
  query, 
  where, 
  orderBy, 
  addDoc, 
  onSnapshot
} from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";

// Initialize the Firebase App
const app = initializeApp(firebaseConfig);

// Initialize Auth & Firestore with database IDs
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

// Authentication Providers
export const googleProvider = new GoogleAuthProvider();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

/**
 * Standard robust error logger required by System Instructions for permission diagnostics.
 */
export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid || null,
      email: auth.currentUser?.email || null,
      emailVerified: auth.currentUser?.emailVerified || null,
      isAnonymous: auth.currentUser?.isAnonymous || null,
      tenantId: auth.currentUser?.tenantId || null,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error("Firestore Error: ", JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

/**
 * Sync all files to Firestore for a specific user.
 */
export async function syncFilesToCloud(userId: string, files: any[]) {
  const pathForWrite = "files";
  try {
    for (const f of files) {
      const docId = `${userId}_${f.name.replace(/[^a-zA-Z0-9_\-]/g, "_")}`;
      const docRef = doc(db, pathForWrite, docId);
      await setDoc(docRef, {
        userId,
        path: f.path,
        name: f.name,
        platform: f.platform,
        content: f.content,
        updatedAt: new Date().toISOString()
      }, { merge: true });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, pathForWrite);
  }
}

/**
 * Fetch files for a specific user from Firestore.
 */
export async function getFilesFromCloud(userId: string): Promise<any[]> {
  const pathForQuery = "files";
  try {
    const q = query(collection(db, pathForQuery), where("userId", "==", userId));
    const snapshot = await getDocs(q);
    const result: any[] = [];
    snapshot.forEach(docSnap => {
      result.push(docSnap.data());
    });
    return result;
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, pathForQuery);
    return [];
  }
}

/**
 * Write a chat message thread to Firestore.
 */
export async function saveChatMessageToCloud(userId: string, role: 'user' | 'model', text: string, timestamp: string) {
  const pathForWrite = "chat";
  try {
    const docId = `msg_${userId}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const docRef = doc(db, pathForWrite, docId);
    await setDoc(docRef, {
      userId,
      role,
      text,
      timestamp,
      createdAt: new Date().toISOString()
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, pathForWrite);
  }
}

/**
 * Load chat history for a specific user from Firestore.
 */
export async function loadChatHistoryFromCloud(userId: string): Promise<any[]> {
  const pathForQuery = "chat";
  try {
    const q = query(
      collection(db, pathForQuery), 
      where("userId", "==", userId)
    );
    const snapshot = await getDocs(q);
    const result: any[] = [];
    snapshot.forEach(docSnap => {
      result.push(docSnap.data());
    });
    // Sort client-side of createdAt since firestore indexes require deployment for complex sorting
    return result.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, pathForQuery);
    return [];
  }
}

export { signInAnonymously, signInWithPopup, signOut };
